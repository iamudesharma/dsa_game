//! SSE JSON is encoded incrementally. Byte permits stay attached to body chunks
//! until the HTTP stack drops them, so queued and in-flight output share one cap.
use axum::{
    body::{Body, Bytes},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
};
use serde_json::Value;
use std::{
    convert::Infallible,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::{mpsc, Notify, OwnedSemaphorePermit, Semaphore};

#[derive(Clone, Default)]
pub struct Cancel {
    flag: Arc<AtomicBool>,
    notify: Arc<Notify>,
}
impl Cancel {
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Acquire)
    }
    pub async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}
struct OnDrop(Cancel);
impl Drop for OnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
struct Chunk {
    bytes: Vec<u8>,
    _permit: OwnedSemaphorePermit,
}
impl AsRef<[u8]> for Chunk {
    fn as_ref(&self) -> &[u8] {
        &self.bytes
    }
}
#[derive(Clone)]
pub struct Output {
    sender: mpsc::Sender<Bytes>,
    budget: Arc<Semaphore>,
    chunk: usize,
    cancel: Cancel,
}
impl Output {
    pub async fn emit(&self, value: Value) -> Result<(), InfallibleOutput> {
        let mut encoder = Encoder::new(value, self.chunk);
        loop {
            // Reserve before encoding; the encoded allocation is always accounted.
            let permit = tokio::select! {biased;_ = self.cancel.cancelled()=>return Err(InfallibleOutput),permit=self.budget.clone().acquire_many_owned(self.chunk as u32)=>permit.map_err(|_|InfallibleOutput)?};
            let Some(bytes) = encoder.next() else {
                break;
            };
            let bytes = Bytes::from_owner(Chunk {
                bytes,
                _permit: permit,
            });
            tokio::select! {biased;_ = self.cancel.cancelled()=>return Err(InfallibleOutput),result=self.sender.send(bytes)=>result.map_err(|_|InfallibleOutput)?};
        }
        Ok(())
    }
    pub fn cancel(&self) -> &Cancel {
        &self.cancel
    }
}
#[derive(Debug)]
pub struct InfallibleOutput;
impl std::fmt::Display for InfallibleOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SSE output closed")
    }
}
impl std::error::Error for InfallibleOutput {}
pub fn channel(budget: usize, cancel: Cancel) -> (Output, Response) {
    let chunk = budget.min(16384);
    let (sender, receiver) = mpsc::channel((budget / chunk).max(1));
    let output = Output {
        sender,
        budget: Arc::new(Semaphore::new(budget)),
        chunk,
        cancel: cancel.clone(),
    };
    let stream = futures_util::stream::unfold(
        (receiver, OnDrop(cancel)),
        |(mut receiver, guard)| async move {
            receiver
                .recv()
                .await
                .map(|bytes| (Ok::<_, Infallible>(bytes), (receiver, guard)))
        },
    );
    // Axum supplies the SSE response headers. A streamed JSON body handles large
    // complete events without Event::json_data buffering the entire event.
    let mut response =
        Sse::new(futures_util::stream::empty::<Result<Event, Infallible>>()).into_response();
    *response.body_mut() = Body::from_stream(stream);
    response
        .headers_mut()
        .insert("connection", "keep-alive".parse().unwrap());
    (output, response)
}

enum Part {
    Value(Value),
    Atom(Vec<u8>, usize),
    String(String, usize, bool),
    Object(serde_json::map::IntoIter, bool),
    Array(std::vec::IntoIter<Value>, bool),
}
struct Encoder {
    parts: Vec<Part>,
    chunk: usize,
}
impl Encoder {
    fn new(value: Value, chunk: usize) -> Self {
        Self {
            parts: vec![
                Part::Atom(b"\n\n".to_vec(), 0),
                Part::Value(value),
                Part::Atom(b"data: ".to_vec(), 0),
            ],
            chunk,
        }
    }
    fn atom(&mut self, s: &str) {
        self.parts.push(Part::Atom(s.as_bytes().to_vec(), 0));
    }
}
impl Iterator for Encoder {
    type Item = Vec<u8>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.parts.is_empty() {
            return None;
        }
        let mut bytes = Vec::with_capacity(self.chunk);
        while bytes.len() < self.chunk {
            let Some(part) = self.parts.pop() else {
                break;
            };
            match part {
                Part::Atom(atom, at) => {
                    let n = (self.chunk - bytes.len()).min(atom.len() - at);
                    bytes.extend_from_slice(&atom[at..at + n]);
                    if at + n < atom.len() {
                        self.parts.push(Part::Atom(atom, at + n));
                    }
                }
                Part::String(s, at, false) => {
                    self.parts.push(Part::String(s, at, true));
                    self.atom("\"");
                }
                Part::String(s, at, true) => {
                    if at == s.len() {
                        self.atom("\"");
                    } else {
                        let c = s[at..].chars().next().unwrap();
                        let next = at + c.len_utf8();
                        let escaped = match c {
                            '"' => "\\\"".into(),
                            '\\' => "\\\\".into(),
                            '\n' => "\\n".into(),
                            '\r' => "\\r".into(),
                            '\t' => "\\t".into(),
                            '\u{0008}' => "\\b".into(),
                            '\u{000c}' => "\\f".into(),
                            c if (c as u32) < 32 => format!("\\u{:04x}", c as u32),
                            c => c.to_string(),
                        };
                        self.parts.push(Part::String(s, next, true));
                        self.atom(&escaped);
                    }
                }
                Part::Value(Value::Object(o)) => {
                    self.atom("}");
                    self.parts.push(Part::Object(o.into_iter(), true));
                    self.atom("{");
                }
                Part::Value(Value::Array(a)) => {
                    self.atom("]");
                    self.parts.push(Part::Array(a.into_iter(), true));
                    self.atom("[");
                }
                Part::Value(Value::String(s)) => self.parts.push(Part::String(s, 0, false)),
                Part::Value(v) => self.atom(&v.to_string()),
                Part::Object(mut iterator, first) => {
                    if let Some((key, value)) = iterator.next() {
                        self.parts.push(Part::Object(iterator, false));
                        self.parts.push(Part::Value(value));
                        self.atom(":");
                        self.parts.push(Part::String(key, 0, false));
                        if !first {
                            self.atom(",");
                        }
                    }
                }
                Part::Array(mut iterator, first) => {
                    if let Some(value) = iterator.next() {
                        self.parts.push(Part::Array(iterator, false));
                        self.parts.push(Part::Value(value));
                        if !first {
                            self.atom(",");
                        }
                    }
                }
            }
        }
        Some(bytes)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn chunked_json_preserves_unicode_escaping_and_event_format() {
        let value = json!({"text":"Unicode 😀 \"\\\n\r\t\u{0000}\u{0008}\u{000c}","values":[true,null,1,-3,1.25,{},[]]});
        for size in [1, 2, 5, 17, 1024] {
            let bytes: Vec<_> = Encoder::new(value.clone(), size).flatten().collect();
            assert_eq!(bytes, format!("data: {value}\n\n").as_bytes());
        }
    }
    #[tokio::test]
    async fn output_budget_covers_chunks_held_by_the_http_consumer() {
        use futures_util::StreamExt;
        let cancel = Cancel::default();
        let (output, response) = channel(32, cancel.clone());
        let budget = output.budget.clone();
        let task = tokio::spawn(async move { output.emit(json!({"text":"x".repeat(1024)})).await });
        let mut body = response.into_body().into_data_stream();
        let chunk = body.next().await.unwrap().unwrap();
        assert_eq!(budget.available_permits(), 0);
        // The chunk's allocation retains its permit even after leaving the queue.
        assert!(!task.is_finished());
        drop(body);
        assert!(cancel.is_cancelled());
        assert!(task.await.unwrap().is_err());
        drop(chunk);
        assert_eq!(budget.available_permits(), 32);
    }
}
