// 深度诊断：探索新 Overleaf 编辑器架构
// 复制到浏览器控制台运行

(function() {
  console.log('=== 🔬 深度诊断：新 Overleaf 架构 ===\n');

  // 1. 找到 CodeMirror 视图
  console.log('1️⃣ 查找 CodeMirror 视图对象:');
  const cmElements = document.querySelectorAll('.cm-editor');

  cmElements.forEach((el, i) => {
    console.log(`\n编辑器 ${i + 1}:`);

    // 尝试访问各种可能的属性
    const possibleProps = [
      '__cm_view',
      'cmView',
      'view',
      '_view',
      'editorView'
    ];

    possibleProps.forEach(prop => {
      const val = (el as any)[prop];
      if (val) {
        console.log(`  ✅ ${prop}:`, val);
        console.log(`     - state: ${val.state ? 'Found' : 'Missing'}`);
        console.log(`     - state.doc: ${val.state?.doc ? 'Found' : 'Missing'}`);

        if (val.state?.doc) {
          const doc = val.state.doc;
          console.log(`     - doc 类型:`, doc.constructor.name);
          console.log(`     - doc toString:`, doc.toString?.().substring(0, 50));

          // 检查是否有版本相关的方法
          console.log(`     - doc 版本号:`, doc.version);
          console.log(`     - doc children:`, doc.children ? doc.children.length : 'N/A');
        }
      }
    });
  });

  // 2. 从堆栈中找到关键函数
  console.log('\n2️⃣ 搜索 handleUpdateFromCM 函数:');

  // 这个函数在 codemirror-editor 脚本中
  const scripts = Array.from(document.querySelectorAll('script[src*="codemirror-editor"]'));
  console.log(`找到 ${scripts.length} 个 codemirror-editor 脚本`);

  scripts.forEach((script, i) => {
    console.log(`  脚本 ${i + 1}:`, (script as HTMLScriptElement).src);
  });

  // 3. 查找 React DevTools 全局变量（Overleaf 可能用 React）
  console.log('\n3️⃣ 检查 React DevTools:');
  const reactKeys = Object.keys(window).filter(key =>
    key.includes('__REACT') ||
    key.includes('_reactRoot') ||
    key.includes('_reactFiber')
  );

  if (reactKeys.length > 0) {
    console.log('找到 React 相关变量:');
    reactKeys.slice(0, 5).forEach(key => console.log(`  - ${key}`));
  } else {
    console.log('❌ 没有找到 React DevTools 变量');
  }

  // 4. 监听并分析下一次编辑事件
  console.log('\n4️⃣ 设置详细的事件监听器:');

  const events = ['input', 'change', 'keyup', 'paste'];
  let firedCount = 0;

  events.forEach(eventType => {
    const handler = (e: Event) => {
      if (firedCount < 3) { // 只记录前3次
        firedCount++;
        console.log(`\n✅ ${eventType} 事件触发:`);
        console.log('  目标:', e.target);
        console.log('  目标类名:', (e.target as HTMLElement).className);

        // 检查目标元素周围的 CodeMirror 结构
        const cmEditor = (e.target as HTMLElement).closest('.cm-editor');
        if (cmEditor) {
          console.log('  找到 .cm-editor 父级');

          // 查找 view 对象
          const view = (cmEditor as any).__cm_view || cmEditor.cmView;
          if (view) {
            console.log('  ✅ 找到 view 对象!');
            console.log('  view.state:', !!view.state);
            console.log('  view.state.doc:', !!view.state?.doc);

            if (view.state?.doc) {
              const doc = view.state.doc;
              console.log('  文档内容预览:', doc.toString().substring(0, 100));
            }
          }
        }
      }
    };

    document.addEventListener(eventType, handler, true);
  });

  console.log('\n现在请输入一些文字，我会分析事件...\n');

  // 5. 检查是否有全局的编辑器管理器
  setTimeout(() => {
    console.log('\n5️⃣ 延迟检查（等待页面完全加载）:');

    const possibleManagers = [
      'ide',
      'editor',
      'documentManager',
      'docManager',
      'sharejs'
    ];

    possibleManagers.forEach(key => {
      const obj = (window as any)[key];
      if (obj) {
        console.log(`  ✅ window.${key}:`, obj);
        console.log(`     - 类型:`, typeof obj);
        console.log(`     - 键:`, Object.keys(obj).slice(0, 5).join(', '));
      }
    });
  }, 2000);

  // 6. 检查 Overleaf 特定的全局变量
  setTimeout(() => {
    console.log('\n6️⃣ 检查 Overleaf 特定变量:');

    const overleafKeys = Object.keys(window).filter(key =>
      key.includes('overleaf') ||
      key.includes('ol_') ||
      key.includes('tex')
    );

    if (overleafKeys.length > 0) {
      console.log('找到 Overleaf 相关变量:');
      overleafKeys.slice(0, 10).forEach(key => {
        const val = (window as any)[key];
        console.log(`  - ${key}:`, typeof val, val);
      });
    } else {
      console.log('❌ 没有找到明显的 Overleaf 特定变量');
    }
  }, 2000);
})();
