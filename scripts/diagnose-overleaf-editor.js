// Overleaf 新编辑器一键诊断
// 直接复制到浏览器控制台运行

(function() {
  console.log('=== 🔍 Overleaf 新编辑器诊断 ===\n');

  // 1. 查找编辑器相关全局变量
  console.log('1️⃣ 搜索编辑器相关全局变量:');
  const editorKeys = Object.keys(window).filter(key =>
    key.toLowerCase().includes('editor') ||
    key.toLowerCase().includes('ide') ||
    key.toLowerCase().includes('doc') ||
    key.toLowerCase().includes('cm')
  );
  editorKeys.forEach(key => {
    const val = window[key];
    const type = typeof val;
    const isObj = type === 'object' && val !== null;
    console.log(`  - ${key}: ${type}${isObj ? ` (${Object.keys(val).length} keys)` : ''}`);
  });

  // 2. 查找 React 组件
  console.log('\n2️⃣ 查找 React 根节点:');
  const rootElements = [
    document.querySelector('#editor'),
    document.querySelector('#ide'),
    document.querySelector('[data-overleaf-editor]')
  ].filter(el => el !== null);

  rootElements.forEach((el, i) => {
    console.log(`  元素 ${i + 1}:`, el);
    console.log(`    类名:`, el.className);
    console.log(`    React fiber:`, el._reactRootContainer?._internalRoot);
  });

  // 3. 查找 CodeMirror 实例
  console.log('\n3️⃣ 查找 CodeMirror 编辑器:');
  const cmElements = document.querySelectorAll('.cm-editor, [class*="cm-editor"]');
  console.log(`  找到 ${cmElements.length} 个 CodeMirror 元素`);

  cmElements.forEach((el, i) => {
    console.log(`  编辑器 ${i + 1}:`, el);
    // 查找可能的视图对象
    const view = (el as any).__cm_view || el.cmView || (el as any).view;
    console.log(`    View: ${view ? 'Found' : 'Not found'}`);
    if (view) {
      console.log(`    View.state: ${view.state ? 'Found' : 'Not found'}`);
      if (view.state) {
        console.log(`    View.doc: ${view.state.doc ? 'Found' : 'Not found'}`);
      }
    }
  });

  // 4. 查找当前文档内容
  console.log('\n4️⃣ 尝试获取当前文档内容:');
  const editorContent = document.querySelector('.cm-content');
  if (editorContent) {
    console.log(`  找到编辑器内容区域`);
    console.log(`  文本内容:`, editorContent.textContent?.substring(0, 100));
  }

  // 5. 监听下一次编辑事件
  console.log('\n5️⃣ 设置事件监听器（下次编辑时会触发）:');
  let fired = false;
  const handler = (e: Event) => {
    if (!fired) {
      fired = true;
      console.log('\n✅ 检测到编辑事件:', e.type);
      console.log('目标:', e.target);
      console.log('详情:', e);

      // 再次搜索，看编辑时是否有新的全局对象
      setTimeout(() => {
        console.log('\n📝 编辑后的全局变量:');
        const newEditorKeys = Object.keys(window).filter(key =>
          key.toLowerCase().includes('editor') ||
          key.toLowerCase().includes('doc')
        ).slice(0, 10);
        newEditorKeys.forEach(key => console.log(`  - ${key}`));
      }, 100);
    }
  };

  document.addEventListener('input', handler, { once: true });
  console.log('  请在编辑器中输入一些文字...');

  // 6. 检查是否有新的编辑器事件
  console.log('\n6️⃣ 已注册的自定义事件:');
  const customEvents = [
    'doc:changed',
    'editor:change',
    'document:change',
    'editor:update'
  ];
  customEvents.forEach(eventName => {
    const hasListener = getEventListeners(window)?.[eventName];
    console.log(`  ${eventName}: ${hasListener ? '✅ 有监听器' : '❌ 无监听器'}`);
  });

  console.log('\n=== 诊断完成 ===');
  console.log('💡 现在请在编辑器中输入一些文字，查看触发的事件\n');

  // 辅助函数：获取事件监听器（Chrome 特定）
  function getEventListeners(element: any) {
    if (typeof element.getEventListeners === 'function') {
      return element.getEventListeners();
    }
    // DevTools 特定 API
    if (typeof chrome !== 'undefined' && chrome.devtools) {
      return chrome.devtools.inspectedWindow;
    }
    return null;
  }
})();
