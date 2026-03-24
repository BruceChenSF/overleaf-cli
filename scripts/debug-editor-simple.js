// Overleaf Editor Diagnostic Script - Copy to browser console

console.log('=== Overleaf Editor Diagnostic ===');
console.log('');

// 1. Check common editor variables
console.log('1. Checking common editor variables:');

if (window.editor) {
  console.log('✅ window.editor exists');
  console.log('   Type:', typeof window.editor);
  console.log('   Keys:', Object.keys(window.editor).slice(0, 20).join(', '));
} else {
  console.log('❌ window.editor not defined');
}

if (window.ace) {
  console.log('✅ window.ace exists');
  console.log('   Type:', typeof window.ace);
  if (window.ace.edit) {
    console.log('   ✅ Has edit function');
  }
} else {
  console.log('❌ window.ace not defined');
}

if (window.CodeMirror) {
  console.log('✅ window.CodeMirror exists');
} else {
  console.log('❌ window.CodeMirror not defined');
}

// 2. Check DOM elements
console.log('');
console.log('2. Checking DOM elements:');

var aceElements = document.querySelectorAll('.ace_editor');
console.log('Ace Editor elements found:', aceElements.length);

if (aceElements.length > 0) {
  for (var i = 0; i < aceElements.length; i++) {
    var el = aceElements[i];
    console.log('  [' + i + '] id:', el.id);
    console.log('      class:', el.className);

    // Try to get editor from element
    if (el.ace) {
      console.log('      ✅ Has .ace property');
      console.log('         getValue:', typeof el.ace.getValue);
      console.log('         setValue:', typeof el.ace.setValue);
    }

    if (el.env && el.env.editor) {
      console.log('      ✅ Has .env.editor property');
      console.log('         getValue:', typeof el.env.editor.getValue);
      console.log('         setValue:', typeof el.env.editor.setValue);
    }
  }
}

var cmElements = document.querySelectorAll('.CodeMirror');
console.log('CodeMirror elements found:', cmElements.length);

if (cmElements.length > 0) {
  for (var i = 0; i < cmElements.length; i++) {
    var el = cmElements[i];
    console.log('[' + i + '] id:', el.id);
    if (el.CodeMirror) {
      console.log('  ✅ Has CodeMirror instance');
    }
  }
}

// 3. Try to use ace.edit() on first element
console.log('');
console.log('3. Testing ace.edit():');

var firstAceEl = document.querySelector('.ace_editor');
if (firstAceEl) {
  console.log('Found first .ace_editor element');

  if (window.ace && window.ace.edit) {
    try {
      var editor = window.ace.edit(firstAceEl);
      console.log('✅ Got editor instance!');
      console.log('   getValue type:', typeof editor.getValue);
      console.log('   setValue type:', typeof editor.setValue);
      console.log('   session type:', typeof editor.session);

      // Try to get current content
      try {
        var content = editor.getValue();
        console.log('   ✅ Current content length:', content.length);
        console.log('   First 50 chars:', content.substring(0, 50));
      } catch (e) {
        console.log('   ❌ Cannot getValue:', e.message);
      }

    } catch (e) {
      console.log('❌ Failed to get editor:', e.message);
    }
  } else {
    console.log('❌ window.ace.edit not available');
  }
} else {
  console.log('❌ No .ace_editor element found');
}

// 4. Check for Overleaf specific properties
console.log('');
console.log('4. Checking Overleaf-specific properties:');

if (window.editor && window.editor.documentManager) {
  console.log('✅ window.editor.documentManager exists');

  var getCurrentDoc = window.editor.documentManager.getCurrentDoc;
  if (typeof getCurrentDoc === 'function') {
    console.log('   ✅ Has getCurrentDoc function');

    try {
      var currentDoc = getCurrentDoc.call(window.editor.documentManager);
      if (currentDoc) {
        console.log('   Current doc id:', currentDoc.id);
        console.log('   Current doc name:', currentDoc.name);
      } else {
        console.log('   ❌ getCurrentDoc returned null');
      }
    } catch (e) {
      console.log('   ❌ Error calling getCurrentDoc:', e.message);
    }
  }
}

if (window.editor && window.editor.sharejs_doc) {
  console.log('✅ window.editor.sharejs_doc exists');
  console.log('   Type:', typeof window.editor.sharejs_doc);
  console.log('   Keys:', Object.keys(window.editor.sharejs_doc).join(', '));

  if (window.editor.sharejs_doc.session) {
    console.log('   ✅ Has session');
    console.log('      getValue:', typeof window.editor.sharejs_doc.session.getValue);
    console.log('      setValue:', typeof window.editor.sharejs_doc.session.setValue);
  }
}

// 5. Check for Monaco
console.log('');
console.log('5. Checking for Monaco Editor:');

var monacoElements = document.querySelectorAll('.monaco-editor');
console.log('Monaco elements found:', monacoElements.length);

if (window.monaco) {
  console.log('✅ window.monaco exists');
} else {
  console.log('❌ window.monaco not defined');
}

// 6. Summary
console.log('');
console.log('=== Summary ===');
console.log('Please share the output above.');
console.log('');
console.log('Key things to look for:');
console.log('1. Is window.ace defined?');
console.log('2. Are there .ace_editor elements?');
console.log('3. Can we call ace.edit() successfully?');
console.log('4. Does window.editor.sharejs_doc.session exist?');
