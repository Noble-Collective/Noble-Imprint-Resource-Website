// CodeMirror 6 entry point — bundled into a single file by esbuild
// Core
export { basicSetup, EditorView } from 'codemirror';
export { EditorState, StateField, StateEffect, Compartment, EditorSelection, Annotation } from '@codemirror/state';

// View primitives for decorations and plugins
export { Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';

// Language support
export { markdown } from '@codemirror/lang-markdown';

// Diff library
export { diffWords, diffChars } from 'diff';

// @-mention autocomplete
export { default as Tribute } from 'tributejs';
