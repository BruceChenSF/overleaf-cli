// 诊断 Overleaf 页面结构，找到文件名
// 复制到浏览器控制台运行

(function() {
  console.log('=== 🔍 诊断 Overleaf 文件名提取 ===\n');

  // 1. 检查页面标题
  console.log('1️⃣ 页面标题:');
  var title = document.querySelector('title');
  console.log('  标题元素:', title);
  console.log('  标题文本:', title ? title.textContent : undefined);
  console.log('  标题 HTML:', title ? title.innerHTML : undefined);

  // 2. 检查 URL
  console.log('\n2️⃣ 当前 URL:');
  console.log('  完整 URL:', window.location.href);
  console.log('  路径:', window.location.pathname);
  console.log('  路径分段:', window.location.pathname.split('/').filter(function(p) { return p; }));

  // 3. 搜索所有可能包含文件名的元素
  console.log('\n3️⃣ 查找可能包含文件名的元素:');

  // 查找所有文本包含 ".tex" 的元素
  var allElements = document.querySelectorAll('*');
  var texElements = [];

  for (var i = 0; i < allElements.length; i++) {
    var el = allElements[i];
    var text = el.textContent ? el.textContent.trim() : '';
    // 查找短文本（可能是文件名）
    if (text && text.indexOf('.tex') >= 0 && text.length < 50 && text.length > 3) {
      // 检查是否直接文本节点（不是子元素的嵌套文本）
      if (el.children.length === 0 || (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)) {
        texElements.push({
          tag: el.tagName,
          class: el.className,
          id: el.id,
          text: text,
          visible: window.getComputedStyle(el).display !== 'none'
        });
      }
    }
  }

  // 去重并显示前20个
  var unique = texElements.filter(function(item, index, self) {
    return index === self.findIndex(function(t) { return t.text === item.text; });
  });

  console.log('  找到 ' + unique.length + ' 个包含 ".tex" 的元素:');
  unique.slice(0, 20).forEach(function(item, i) {
    console.log('  ' + (i + 1) + '. <' + item.tag + '>', {
      class: item.class,
      id: item.id,
      text: item.text,
      visible: item.visible
    });
  });

  // 4. 检查特定的 Overleaf 选择器
  console.log('\n4️⃣ 特定的 Overleaf 元素:');

  var selectors = [
    '[class*="file"]',
    '[class*="tab"]',
    '[class*="editor"]',
    '[data-filename]',
    '[data-file]',
    '.filename',
    '.file-name',
    '#current-file',
    '#editor-filename'
  ];

  selectors.forEach(function(sel) {
    var elements = document.querySelectorAll(sel);
    if (elements.length > 0) {
      console.log('  ' + sel + ': 找到 ' + elements.length + ' 个');
      Array.from(elements).slice(0, 3).forEach(function(el, i) {
        var text = el.textContent ? el.textContent.substring(0, 30) : '';
        console.log('    ' + (i + 1) + '.', el.className, text);
      });
    }
  });

  // 5. 检查 React 内部状态（如果有）
  console.log('\n5️⃣ 检查 React fiber:');

  var possibleRoots = [
    document.querySelector('#editor'),
    document.querySelector('#ide'),
    document.querySelector('[data-overleaf-editor]')
  ];

  var rootElements = possibleRoots.filter(function(el) { return el !== null; });

  rootElements.forEach(function(el, i) {
    console.log('  根元素 ' + (i + 1) + ':', el.className || el.id);

    // 查找 React fiber key
    var keys = Object.keys(el);
    var fiberKey = keys.find(function(key) {
      return key.indexOf('reactInternalInstance') >= 0 ||
             key.indexOf('reactFiber') >= 0 ||
             key.indexOf('_react') === 0;
    });

    if (fiberKey) {
      console.log('    Fiber key:', fiberKey);

      // 尝试获取 props
      try {
        var fiber = el[fiberKey];
        if (fiber) {
          console.log('    Fiber 存在: 是');
        }
      } catch (e) {
        console.log('    访问 Fiber 失败:', e.message);
      }
    }
  });

  // 6. 检查全局变量
  console.log('\n6️⃣ 全局变量:');

  var possibleGlobals = [
    'currentFile',
    'activeFile',
    'openFile',
    'editorFile',
    'document',
    'ide'
  ];

  possibleGlobals.forEach(function(key) {
    var val = window[key];
    if (val) {
      console.log('  window.' + key + ':', typeof val);
      if (typeof val === 'object' && val.name) {
        console.log('    └─ name:', val.name);
      }
    }
  });

  console.log('\n✅ 诊断完成！');
  console.log('💡 请告诉我在上面的输出中，哪个元素包含了正确的文件名 "name2.tex"');
})();
