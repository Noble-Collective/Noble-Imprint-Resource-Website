// CodeMirror 6 entry point — bundled into a single file by esbuild
// Core
export { basicSetup, EditorView } from 'codemirror';
export { EditorState, StateField, StateEffect } from '@codemirror/state';

// View primitives for decorations and plugins
export { Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';

// Language support
export { markdown } from '@codemirror/lang-markdown';

// Diff library
export { diffWords } from 'diff';
