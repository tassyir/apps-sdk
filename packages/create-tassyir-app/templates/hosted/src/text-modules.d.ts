// The built page, imported as text by src/worker.ts: esbuild (and so
// `tassyir deploy`) loads .html and .txt files as strings.
declare module '*.html' {
  const text: string;
  export default text;
}
declare module '*.txt' {
  const text: string;
  export default text;
}
