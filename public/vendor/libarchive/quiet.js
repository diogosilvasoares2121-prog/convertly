// Evaluated before libarchive's worker bundle: libarchive prints its own diagnostics
// (e.g. "[Unrecognized archive format]"); Convertly reports errors through its UI instead.
const noop = () => {};
console.log = noop;
console.info = noop;
console.warn = noop;
console.error = noop;
