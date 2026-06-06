import type { AlgoLanguage, AlgoStatus } from '../types'

export interface JudgeResult {
  status: AlgoStatus
  passedCount: number
  totalCount: number
  runtime?: number
  errorMessage?: string
  details: TestCaseResult[]
}

export interface TestCaseResult {
  input: string
  expectedOutput: string
  actualOutput: string
  status: AlgoStatus
  errorMessage?: string
  runtime?: number
}

export interface JudgeOptions {
  code: string
  language: AlgoLanguage
  testCases: { input: string; output: string }[]
  timeLimit?: number
}

const JS_WORKER_CODE = `
self.onmessage = function(e) {
  const { code, input } = e.data;
  let output = '';
  let inputLines = input.split('\\n');
  let lineIndex = 0;

  function readline() {
    return inputLines[lineIndex++] || '';
  }

  const originalLog = console.log;
  console.log = function(...args) {
    output += args.join(' ') + '\\n';
  };

  try {
    const fn = new Function('readline', 'console', code);
    fn(readline, console);
    self.postMessage({ success: true, output });
  } catch (err) {
    self.postMessage({ success: false, error: err.message || String(err) });
  }
};
`;

function runJSWorker(code: string, input: string, timeLimit: number): Promise<{ output: string; error?: string }> {
  return new Promise((resolve) => {
    const blob = new Blob([JS_WORKER_CODE], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ output: '', error: 'Time Limit Exceeded' });
    }, timeLimit);

    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data.success) {
        resolve({ output: e.data.output });
      } else {
        resolve({ output: '', error: e.data.error });
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ output: '', error: err.message || 'Worker error' });
    };

    worker.postMessage({ code, input });
  });
}

async function runPython(code: string, input: string, timeLimit: number): Promise<{ output: string; error?: string }> {
  try {
    const pyodideModule = await import('pyodide');
    const { loadPyodide } = pyodideModule;
    const pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/' });

    const lines = input.split('\n');
    let idx = 0;
    pyodide.setStdin({ readline: () => lines[idx++] || '' });

    let output = '';
    pyodide.setStdout({ batched: (text: string) => { output += text + '\n'; } });
    pyodide.setStderr({ batched: (text: string) => { output += text + '\n'; } });

    await pyodide.loadPackagesFromImports(code);
    await pyodide.runPythonAsync(code);
    return { output };
  } catch (err: any) {
    return { output: '', error: err.message || String(err) };
  }
}

async function runJavaPiston(code: string, input: string, timeLimit: number): Promise<{ output: string; error?: string }> {
  try {
    const response = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'java',
        version: '15.0.2',
        files: [{ content: code }],
        stdin: input,
        compile_timeout: 10000,
        run_timeout: timeLimit,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { output: '', error: data.message || `API error: ${response.status}` };
    }

    if (data.compile && data.compile.code !== 0 && data.compile.code !== undefined) {
      return { output: '', error: `Compilation Error:\n${data.compile.stderr || data.compile.output || ''}` };
    }

    if (data.run && data.run.code !== 0 && data.run.code !== undefined) {
      return { output: data.run.stdout || '', error: data.run.stderr || data.run.output || 'Runtime Error' };
    }

    return { output: data.run?.stdout || '' };
  } catch (err: any) {
    return { output: '', error: err.message || String(err) };
  }
}

function normalizeOutput(output: string): string {
  return output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

export async function judgeCode(options: JudgeOptions): Promise<JudgeResult> {
  const { code, language, testCases, timeLimit = 2000 } = options;
  const details: TestCaseResult[] = [];
  let passedCount = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const startTime = performance.now();

    let result: { output: string; error?: string };

    if (language === 'javascript') {
      result = await runJSWorker(code, tc.input, timeLimit);
    } else if (language === 'python') {
      result = await runPython(code, tc.input, timeLimit);
    } else if (language === 'java') {
      result = await runJavaPiston(code, tc.input, timeLimit);
    } else {
      result = { output: '', error: 'Unsupported language' };
    }

    const runtime = Math.round(performance.now() - startTime);

    if (result.error === 'Time Limit Exceeded') {
      details.push({
        input: tc.input,
        expectedOutput: tc.output,
        actualOutput: '',
        status: 'tle',
        errorMessage: 'Time Limit Exceeded',
        runtime,
      });
      continue;
    }

    if (result.error) {
      const isCompileError = result.error.includes('Compilation Error');
      details.push({
        input: tc.input,
        expectedOutput: tc.output,
        actualOutput: result.output,
        status: isCompileError ? 'ce' : 're',
        errorMessage: result.error,
        runtime,
      });
      continue;
    }

    const actual = normalizeOutput(result.output);
    const expected = normalizeOutput(tc.output);

    if (actual === expected) {
      passedCount++;
      details.push({
        input: tc.input,
        expectedOutput: tc.output,
        actualOutput: result.output,
        status: 'ac',
        runtime,
      });
    } else {
      details.push({
        input: tc.input,
        expectedOutput: tc.output,
        actualOutput: result.output,
        status: 'wa',
        runtime,
      });
    }
  }

  const totalCount = testCases.length;
  let finalStatus: AlgoStatus = 'pending';

  if (passedCount === totalCount) {
    finalStatus = 'ac';
  } else if (details.some((d) => d.status === 'ce')) {
    finalStatus = 'ce';
  } else if (details.some((d) => d.status === 're')) {
    finalStatus = 're';
  } else if (details.some((d) => d.status === 'tle')) {
    finalStatus = 'tle';
  } else {
    finalStatus = 'wa';
  }

  return {
    status: finalStatus,
    passedCount,
    totalCount,
    errorMessage: details.find((d) => d.status !== 'ac')?.errorMessage,
    details,
  };
}
