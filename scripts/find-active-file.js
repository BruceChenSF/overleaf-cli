// 找到当前正在编辑的文件名
// 复制到浏览器控制台运行

(function() {
  console.log('=== 🎯 查找当前激活的文件名 ===\n');

  // 方法1: 查找有 active/selected 类的元素
  console.log('1️⃣ 查找激活的标签页:');

  var activeElements = document.querySelectorAll('[class*="active"], [class*="selected"], [class*="open-rail"]');
  console.log('  找到 ' + activeElements.length + ' 个激活/选中元素:');

  Array.from(activeElements).forEach(function(el, i) {
    var text = el.textContent ? el.textContent.trim().substring(0, 50) : '';
    if (text && text.length > 0) {
      console.log('  ' + (i + 1) + '. ' + el.className, ':', text);
    }
  });

  // 方法2: 查找编辑器区域的文件名显示
  console.log('\n2️⃣ 查找编辑器标题栏:');

  var editorSelectors = [
    '.editor-header',
    '.file-title',
    '.filename',
    '[class*="current-file"]',
    '[class*="editor-title"]',
    'ide-rail-tab-link.active'
  ];

  editorSelectors.forEach(function(sel) {
    var elements = document.querySelectorAll(sel);
    if (elements.length > 0) {
      console.log('  ' + sel + ': 找到 ' + elements.length + ' 个');
      Array.from(elements).forEach(function(el) {
        var text = el.textContent ? el.textContent.trim() : '';
        if (text) {
          console.log('    文本:', text);
          console.log('    HTML:', el.innerHTML);
        }
      });
    }
  });

  // 方法3: 查找所有包含 .tex 的 SPAN，然后检查哪个是激活的
  console.log('\n3️⃣ 查找文件列表中的激活状态:');

  var allSpans = document.querySelectorAll('span');
  var texSpans = [];

  for (var i = 0; i < allSpans.length; i++) {
    var span = allSpans[i];
    var text = span.textContent ? span.textContent.trim() : '';
    if (text && text.indexOf('.tex') >= 0 && text.length < 50 && text.indexOf('.tex') === text.length - 4) {
      // 检查父元素或兄弟元素是否有激活标记
      var parent = span.parentElement;
      var isActive = false;
      var activeClass = '';

      // 检查自身
      if (span.className && (span.className.indexOf('active') >= 0 || span.className.indexOf('selected') >= 0)) {
        isActive = true;
        activeClass = span.className;
      }
      // 检查父元素
      else if (parent) {
        if (parent.className && parent.className.indexOf('active') >= 0) {
          isActive = true;
          activeClass = parent.className;
        }
        // 检查父元素的父元素
        var grandParent = parent.parentElement;
        if (grandParent && grandParent.className && grandParent.className.indexOf('active') >= 0) {
          isActive = true;
          activeClass = grandParent.className;
        }
      }

      texSpans.push({
        text: text,
        isActive: isActive,
        activeClass: activeClass,
        class: span.className,
        parentClass: parent ? parent.className : ''
      });
    }
  }

  console.log('  找到 ' + texSpans.length + ' 个 .tex 文件:');
  texSpans.forEach(function(item, i) {
    var marker = item.isActive ? '🎯 ' : '   ';
    console.log(marker + (i + 1) + '. ' + item.text + (item.isActive ? ' [激活]' : ''));
    if (item.isActive) {
      console.log('      激活类:', item.activeClass);
    }
  });

  // 方法4: 检查 URL hash
  console.log('\n4️⃣ 检查 URL hash:');

  if (window.location.hash) {
    console.log('  Hash:', window.location.hash);
    var hashMatch = window.location.hash.match(/file=([^&]+)/);
    if (hashMatch) {
      console.log('  ✅ 从 hash 提取文件名:', decodeURIComponent(hashMatch[1]));
    }
  } else {
    console.log('  没有 hash');
  }

  // 方法5: 最后的手段 - 假设第一个激活的就是
  console.log('\n5️⃣ 查找第一个激活的 .tex 文件:');

  var firstActive = texSpans.find(function(item) { return item.isActive; });
  if (firstActive) {
    console.log('  ✅ 找到激活文件:', firstActive.text);
    console.log('      类名:', firstActive.activeClass);
  } else {
    console.log('  ❌ 没有找到激活文件');

    // 如果没有激活标记，尝试查找 URL 中的文件名
    console.log('\n6️⃣ 备用方案: 检查 sessionStorage/localStorage:');

    try {
      for (var j = 0; j < sessionStorage.length; j++) {
        var key = sessionStorage.key(j);
        if (key && (key.indexOf('file') >= 0 || key.indexOf('doc') >= 0 || key.indexOf('editor') >= 0)) {
          console.log('  sessionStorage.' + key + ':', sessionStorage.getItem(key));
        }
      }
    } catch (e) {
      console.log('  访问 sessionStorage 失败:', e.message);
    }

    try {
      for (var k = 0; k < localStorage.length; k++) {
        var key2 = localStorage.key(k);
        if (key2 && (key2.indexOf('file') >= 0 || key2.indexOf('doc') >= 0 || key2.indexOf('editor') >= 0)) {
          var value = localStorage.getItem(key2);
          if (value && value.length < 100) {
            console.log('  localStorage.' + key2 + ':', value);
          }
        }
      }
    } catch (e) {
      console.log('  访问 localStorage 失败:', e.message);
    }
  }

  console.log('\n✅ 诊断完成！');
})();
