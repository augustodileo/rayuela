import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const native = require('./index.js');

export const parseFile = native.parseFile;
export const parseSource = native.parseSource;
export const queryTree = native.queryTree;
export const getLanguageName = native.getLanguageName;
export const validateSpec = native.validateSpec;
export const ParseResult = native.ParseResult;
export const AppGraph = native.AppGraph;
export const TraceStore = native.TraceStore;
export const TraceKind = native.TraceKind;
export const validateTraceSpec = native.validateTraceSpec;
export default native;
