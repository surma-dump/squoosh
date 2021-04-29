import { join, basename, extname } from 'path-browserify';
import { codecs as supportedFormats, preprocessors } from './codecs.js';
import WorkerPool from './worker_pool.js';

function clamp(v, min, max) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

const suffix = ['B', 'KB', 'MB'];
function prettyPrintSize(size) {
  const base = Math.floor(Math.log2(size) / 10);
  const index = clamp(base, 0, 2);
  return (size / 2 ** (10 * index)).toFixed(2) + suffix[index];
}

function progressTracker(results, program) {
  const tracker = {};
  tracker.progressOffset = 0;
  tracker.totalOffset = 0;
  let status = '';
  tracker.setStatus = (text) => {
    status = text || '';
    update();
  };
  let progress = '';
  tracker.setProgress = (done, total) => {
    const completeness =
      (tracker.progressOffset + done) / (tracker.totalOffset + total);
    progress = `▐${'▨'.repeat((completeness * 10) | 0).padEnd(10, '╌')}▌ `;
    update();
  };
  function update() {
    console.log(progress + status.bold() + getResultsText());
  }
  tracker.finish = (text) => {
    console.log('finished', text.bold() + getResultsText());
  };
  function getResultsText() {
    let out = '';
    for (const [filename, result] of results.entries()) {
      out += `\n ${filename}: ${prettyPrintSize(result.size)}`;
      for (const { outputFile, outputSize, infoText } of result.outputs) {
        const name = (program.suffix + extname(outputFile)).padEnd(5);
        out += `\n  ${'└'} ${name} → ${prettyPrintSize(outputSize)}`;
        const percent = ((outputSize / result.size) * 100).toPrecision(3);
        out += ` (${percent}%)`;
        if (infoText) out += infoText;
      }
    }
    return out || '\n';
  }
  return tracker;
}

export async function run({
  files = [],
  suffix = '',
  optimizerButteraugliTarget = false,
  outputDir = '',
  maxOptimizerRounds = 8,
  ...extras
}) {
  // We don't output to disk, only memory.

  return await processFiles(files, {
    suffix,
    optimizerButteraugliTarget,
    outputDir,
    maxOptimizerRounds,
    ...extras,
  });
}

async function processFiles(files, program) {
  // files will be files or blobs from the page.
  const parallelism = navigator.hardwareConcurrency;

  const results = new Map();
  const progress = progressTracker(results, program);

  progress.setStatus('Decoding...');
  progress.totalOffset = files.length;
  progress.setProgress(0, files.length);

  const workerPool = new WorkerPool(parallelism);

  let decoded = 0;
  let decodedFiles = await Promise.all(
    files.map(async (file) => {
      const result = await workerPool.dispatchJob({
        operation: 'decode',
        file,
      });
      results.set(file.name, {
        file: result.file,
        size: result.size,
        outputs: [],
      });
      progress.setProgress(++decoded, files.length);
      return result;
    }),
  );

  for (const [preprocessorName, value] of Object.entries(preprocessors)) {
    if (!program[preprocessorName]) {
      continue;
    }
    const preprocessorParam = program[preprocessorName];
    const preprocessorOptions = Object.assign(
      {},
      value.defaultOptions,
      preprocessorParam,
    );

    decodedFiles = await Promise.all(
      decodedFiles.map(async (file) => {
        return workerPool.dispatchJob({
          file,
          operation: 'preprocess',
          preprocessorName,
          options: preprocessorOptions,
        });
      }),
    );
  }

  progress.progressOffset = decoded;
  progress.setStatus(`Encoding (${parallelism} threads)`);
  progress.setProgress(0, files.length);

  const jobs = [];
  let jobsStarted = 0;
  let jobsFinished = 0;
  for (const { file, bitmap, size } of decodedFiles) {
    const ext = extname(file.name);
    const base = basename(file.name, ext) + program.suffix;

    for (const [encName, value] of Object.entries(supportedFormats)) {
      if (!program[encName]) {
        continue;
      }
      const encParam =
        typeof program[encName] === 'string' ? program[encName] : '{}';
      const encConfig =
        encParam.toLowerCase() === 'auto'
          ? 'auto'
          : Object.assign({}, value.defaultEncoderOptions, encParam);
      const outputFile = join(program.outputDir, `${base}.${value.extension}`);
      jobsStarted++;
      const p = workerPool
        .dispatchJob({
          operation: 'encode',
          file,
          size,
          bitmap,
          outputFile,
          encName,
          encConfig,
          optimizerButteraugliTarget: Number(
            program.optimizerButteraugliTarget,
          ),
          maxOptimizerRounds: Number(program.maxOptimizerRounds),
        })
        .then((output) => {
          jobsFinished++;
          results.get(file.name).outputs.push(output);
          progress.setProgress(jobsFinished, jobsStarted);
        });
      jobs.push(p);
    }
  }

  // update the progress to account for multi-format
  progress.setProgress(jobsFinished, jobsStarted);
  // Wait for all jobs to finish
  await workerPool.join();
  await Promise.all(jobs);
  progress.finish('Squoosh results:');

  return results;
}

// processFiles()
// or
// WorkerPool.useThisThreadAsWorker(handleJob);
