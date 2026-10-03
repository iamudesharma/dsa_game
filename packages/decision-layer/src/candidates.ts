/** Revisions and ONNX artifacts verified against the authors' Hugging Face repositories. */
export const CANDIDATES = {
  'minilm-l6': { model: 'sentence-transformers/all-MiniLM-L6-v2', revision: '1110a243fdf4706b3f48f1d95db1a4f5529b4d41', artifact: 'model_qint8_arm64', task: 'semantic', weightsMB: 23 },
  'minilm-l3': { model: 'sentence-transformers/paraphrase-MiniLM-L3-v2', revision: '4ca70771034acceecb2e72475f72050fcdde4ddc', artifact: 'model_qint8_arm64', task: 'semantic', weightsMB: 17.5 },
  xtremedistil: { model: 'MoritzLaurer/xtremedistil-l6-h256-zeroshot-v1.1-all-33', revision: 'c07f66d9cbf781191bee66edfe8ad7856f045781', artifact: 'model_quantized', task: 'zero-shot', weightsMB: 13.1 },
  'deberta-xsmall': { model: 'MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33', revision: '262ae02f29173eec1c250f90804dc7edc677dcff', artifact: 'model_quantized', task: 'zero-shot', weightsMB: 87.2 },
} as const
export type CandidateId = keyof typeof CANDIDATES
