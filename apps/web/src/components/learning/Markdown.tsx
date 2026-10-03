'use client'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  return <div className="relative"><button className="btn text-xs" onClick={async e => { const code = e.currentTarget.parentElement?.querySelector('code')?.textContent ?? ''; try { await navigator.clipboard.writeText(code); setCopied(true) } catch { setCopied(false) } }}>{copied ? 'Copied' : 'Copy code'}</button><pre>{children}</pre></div>
}
export function Markdown({ text }: { text: string }) {
  return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ img:({alt})=><span>{alt}</span>, pre: CodeBlock, a: ({ href, children }) => <a href={href} target={href?.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a> }}>{text}</ReactMarkdown></div>
}
