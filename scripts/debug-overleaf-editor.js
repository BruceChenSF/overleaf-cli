/**
 * Overleaf Editor Diagnostic Script
 *
 * Copy and paste this into the browser console on Overleaf
 * to find the correct way to access the editor instance.
 */

console.log('=== Overleaf Editor Diagnostic ===\n');

// 1. Check for common editor variables
console.log('1. Checking common editor variables:');
const editorVars = [
  'editor',
  'window.editor',
  'ace',
  'window.ace',
  'CodeMirror',
  'window.CodeMirror',
  'ShareJS',
  'window.sharejs'
];

editorVars.forEach(varName => {
  try {
    const value = eval(varName);
    if (value) {
      console.log(`✅ ${varName}:`, typeof value, value);
    } else {
      console.log(`❌ ${varName}: undefined/null`);
    }
  } catch (e) {
    console.log(`❌ ${varName}: Error -`, e.message);
  }
});

// 2. Look for editor in window object
console.log('\n2. Scanning window object for editor-related properties:');
const editorKeys = Object.keys(window).filter(key => {
  const lowerKey = key.toLowerCase();
  return lowerKey.includes('editor') ||
         lowerKey.includes('ace') ||
         lowerKey.includes('codemirror') ||
         lowerKey.includes('sharejs') ||
         lowerKey.includes('document');
});

if (editorKeys.length > 0) {
  console.log('Found editor-related keys:', editorKeys);
  editorKeys.forEach(key => {
    console.log(`  - window.${key}:`, typeof window[key]);
  });
} else {
  console.log('No editor-related keys found');
}

// 3. Check for React/Redux state (Overleaf may use React)
console.log('\n3. Checking for React/Redux:');
if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  console.log('✅ React DevTools detected');
  const roots = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers?.values();
  if (roots) {
    console.log('  React roots found:', Array.from(roots).length);
  }
} else {
  console.log('❌ No React DevTools');
}

if (window.__REDUX_DEVTOOLS_EXTENSION__) {
  console.log('✅ Redux DevTools detected');
} else {
  console.log('❌ No Redux DevTools');
}

// 4. Check for document elements
console.log('\n4. Checking DOM elements:');

// Check for Ace Editor elements
const aceElements = document.querySelectorAll('.ace_editor');
console.log('Ace Editor elements:', aceElements.length);
if (aceElements.length > 0) {
  aceElements.forEach((el, i) => {
    console.log(`  [${i}] id:`, el.id, 'class:', el.className);
    const editor = (el as any).ace || (el as any).env?.editor;
    if (editor) {
      console.log(`     ✅ Has editor instance!`);
      console.log(`     - getValue:`, typeof editor.getValue);
      console.log(`     - setValue:`, typeof editor.setValue);
      console.log(`     - session:`, typeof editor.session);
    }
  });
}

// Check for CodeMirror elements
const cmElements = document.querySelectorAll('.CodeMirror');
console.log('CodeMirror elements:', cmElements.length);
if (cmElements.length > 0) {
  cmElements.forEach((el, i) => {
    console.log(`  [${i}] id:`, el.id, 'class:', el.className);
    const editor = (el as any).CodeMirror;
    if (editor) {
      console.log(`     ✅ Has CodeMirror instance!`);
      console.log(`     - getValue:`, typeof editor.getValue);
      console.log(`     - setValue:`, typeof editor.setValue);
    }
  });
}

// 5. Check for Monaco Editor
const monacoElements = document.querySelectorAll('.monaco-editor');
console.log('Monaco Editor elements:', monacoElements.length);

// 6. Check for Overleaf-specific globals
console.log('\n5. Checking Overleaf-specific globals:');
const overleafVars = [
  'overleaf',
  'window.overleaf',
  'OL',
  'window.OL',
  'App',
  'window.App'
];

overleafVars.forEach(varName => {
  try {
    const value = eval(varName);
    if (value) {
      console.log(`✅ ${varName}:`, typeof value);
      if (typeof value === 'object') {
        console.log('   Keys:', Object.keys(value).slice(0, 10).join(', '));
      }
    } else {
      console.log(`❌ ${varName}: undefined/null`);
    }
  } catch (e) {
    console.log(`❌ ${varName}: Error -`, e.message);
  }
});

// 7. Try to find editor through require (if using modules)
console.log('\n6. Checking for module systems:');
if (typeof require !== 'undefined') {
  console.log('✅ require is available');
  try {
    // Try common module paths
    const ace = require('ace-builds/src-noconflict/ace');
    if (ace) {
      console.log('✅ ace-builds loaded via require');
      console.log('   edit function:', typeof ace.edit);
    }
  } catch (e) {
    console.log('❌ Cannot load ace via require:', e.message);
  }
} else {
  console.log('❌ require not available');
}

// 8. Check for iframe-based editors
console.log('\n7. Checking for iframe editors:');
const iframes = document.querySelectorAll('iframe');
console.log('Total iframes:', iframes.length);
iframes.forEach((iframe, i) => {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const hasAce = iframeDoc.querySelectorAll('.ace_editor').length > 0;
    const hasCM = iframeDoc.querySelectorAll('.CodeMirror').length > 0;
    if (hasAce || hasCM) {
      console.log(`  [${i}] src:`, iframe.src.substring(0, 50));
      console.log(`     - Has Ace:`, hasAce);
      console.log(`     - Has CodeMirror:`, hasCM);
    }
  } catch (e) {
    // Cross-origin restriction
  }
});

// 9. Final summary
console.log('\n=== Summary ===');
console.log('Please share the output of this script so we can identify');
console.log('the correct way to access the Overleaf editor instance.');
console.log('\nTo test if an editor works, try this in console:');
console.log('  1. Find the editor element (look for .ace_editor)');
console.log('  2. Get its instance: ace.edit("elementId")');
console.log('  3. Get value: editor.getValue()');
console.log('  4. Set value: editor.setValue("new content")');
