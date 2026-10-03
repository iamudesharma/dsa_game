import { parentPort, workerData } from 'node:worker_threads'
import { env, pipeline } from '@huggingface/transformers'

// Production never downloads models on an HTTP request. Preparation is explicit.
env.cacheDir = workerData.cacheDir
env.allowRemoteModels = workerData.allowDownload
let classifier
const cache = new Map()
const candidate = workerData.candidate
async function load() {
  classifier ??= await pipeline(candidate.task === 'semantic' ? 'feature-extraction' : 'zero-shot-classification', candidate.model, {
    revision: candidate.revision, dtype: 'fp32', model_file_name: candidate.artifact,
    device: 'cpu', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  })
}
async function embed(texts) {
  const vectors = []
  // Small batches bound ONNX arena allocations during prototype preparation.
  for (let i = 0; i < texts.length; i += 4) {
    vectors.push(...(await classifier(texts.slice(i, i + 4), { pooling: 'mean', normalize: true, truncation: true, max_length: 256 })).tolist())
  }
  return vectors
}
parentPort.on('message', async ({ id, operation, text, examples }) => {
  try {
    await load()
    if (operation === 'prepare') { parentPort.postMessage({ id, ready: true }); return }
    const keys = Object.keys(examples)
    let scores
    if (candidate.task === 'semantic') {
      const signature = JSON.stringify(examples)
      let vectors = cache.get(signature)
      if (!vectors) {
        const values = Object.values(examples).flat()
        const embeddings = await embed(values)
        let offset = 0
        vectors = Object.values(examples).map(group => embeddings.slice(offset, offset += group.length))
        if (cache.size >= 16) cache.delete(cache.keys().next().value)
        cache.set(signature, vectors)
      }
      const [query] = await embed([text])
      scores = vectors.map(group => Math.max(...group.map(vector => vector.reduce((sum, v, i) => sum + v * query[i], 0))))
    } else {
      const labels = keys.map(key => examples[key].join('. '))
      const result = await classifier(text, labels, { multi_label: true, hypothesis_template: 'This request is about {}.' })
      scores = labels.map(label => result.scores[result.labels.indexOf(label)])
    }
    parentPort.postMessage({ id, scores: Object.fromEntries(keys.map((key, i) => [key, scores[i]])) })
  } catch (error) { parentPort.postMessage({ id, error: String(error) }) }
})
