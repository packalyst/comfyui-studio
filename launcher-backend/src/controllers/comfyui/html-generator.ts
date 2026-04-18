// Create HTML page for when ComfyUI is not running
export const getNotRunningHtml = () => {
  // Get environment variables for frontend judgment
  const adminComfyDomain = process.env.DOMAIN_COMFYUI_FOR_ADMIN || '';
  const adminLauncherDomain = process.env.DOMAIN_LAUNCHER_FOR_ADMIN || '';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title id="page-title">ComfyUI Unavailable</title>
    <meta charset="utf-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background-color: white;
      }
      .container {
        text-align: center;
        padding: 2rem;
        max-width: 500px;
      }
      h1 {
        color: #333;
        font-size: 24px;
        margin-bottom: 10px;
      }
      p {
        margin: 8px 0 20px;
        color: #666;
        font-size: 14px;
      }
      .retry-btn {
        background-color: #4a76fd;
        color: white;
        border: none;
        padding: 8px 30px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 500;
      }
      .retry-btn:hover {
        background-color: #3a66ed;
      }
      .launcher-btn {
        background-color: #28a745;
        color: white;
        border: none;
        padding: 8px 30px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 500;
        margin-left: 10px;
      }
      .launcher-btn:hover {
        background-color: #218838;
      }
      .en, .zh {
        display: none;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="zh">
        <h1>ComfyUI 无法使用</h1>
        <p>ComfyUl 服务目前未启动或无法访问。请联系您的 Olares 管理员。</p>
        <div id="button-container-zh">
          <!-- 重试按钮将在脚本中动态添加 -->
        </div>
      </div>
      
      <div class="en">
        <h1>ComfyUI Unavailable</h1>
        <p>The ComfyUI service is currently not running or inaccessible. Please contact your Olares administrator.</p>
        <div id="button-container-en">
          <!-- 重试按钮将在脚本中动态添加 -->
        </div>
      </div>
    </div>
    
    <script>
      // 从服务器端获取环境变量值
      const ADMIN_COMFY_DOMAIN = "${adminComfyDomain}";
      const ADMIN_LAUNCHER_DOMAIN = "${adminLauncherDomain}";

      // 检测浏览器语言并显示相应内容
      (function() {
        // 获取浏览器语言
        const userLang = navigator.language || navigator.userLanguage || '';
        // 默认显示英文，如果是中文环境则显示中文
        const lang = userLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
        
        // 显示对应语言内容
        document.querySelectorAll('.' + lang).forEach(el => {
          el.style.display = 'block';
        });
        
        // 设置对应语言的页面标题
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) {
          pageTitle.textContent = lang === 'zh' ? 'ComfyUI 不可用' : 'ComfyUI Unavailable';
        }

        // 检查当前域名是否为管理员域名
        const currentHostname = window.location.hostname;
        console.log("Current hostname:", currentHostname);
        console.log("Admin ComfyUI domain:", ADMIN_COMFY_DOMAIN);
        
        const containerZh = document.getElementById('button-container-zh');
        const containerEn = document.getElementById('button-container-en');
        
        // 判断是否显示启动器按钮
        const showLauncherButton = ADMIN_COMFY_DOMAIN && currentHostname === ADMIN_COMFY_DOMAIN && ADMIN_LAUNCHER_DOMAIN;
        
        if (showLauncherButton) {
          // 显示启动器按钮，不显示重试按钮
          
          // 为中文界面添加启动器按钮
          if (containerZh) {
            const launcherBtn = document.createElement('button');
            launcherBtn.className = 'launcher-btn';
            launcherBtn.textContent = 'ComfyUI 启动器';
            launcherBtn.onclick = function() {
              window.location.href = ADMIN_LAUNCHER_DOMAIN.startsWith('http') 
                ? ADMIN_LAUNCHER_DOMAIN 
                : 'https://' + ADMIN_LAUNCHER_DOMAIN;
            };
            containerZh.appendChild(launcherBtn);
          }
          
          // 为英文界面添加启动器按钮
          if (containerEn) {
            const launcherBtn = document.createElement('button');
            launcherBtn.className = 'launcher-btn';
            launcherBtn.textContent = 'ComfyUI Launcher';
            launcherBtn.onclick = function() {
              window.location.href = ADMIN_LAUNCHER_DOMAIN.startsWith('http') 
                ? ADMIN_LAUNCHER_DOMAIN 
                : 'https://' + ADMIN_LAUNCHER_DOMAIN;
            };
            containerEn.appendChild(launcherBtn);
          }
        } else {
          // 不显示启动器按钮，显示重试按钮
          
          // 为中文界面添加重试按钮
          if (containerZh) {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'retry-btn';
            retryBtn.textContent = '重试';
            retryBtn.onclick = function() {
              window.location.reload();
            };
            containerZh.appendChild(retryBtn);
          }
          
          // 为英文界面添加重试按钮
          if (containerEn) {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'retry-btn';
            retryBtn.textContent = 'Retry';
            retryBtn.onclick = function() {
              window.location.reload();
            };
            containerEn.appendChild(retryBtn);
          }
        }
      })();
    </script>
  </body>
  </html>
  `;
};
