import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { config, cachePath, paths } from '../../config';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { isComfyUIRunning } from './utils';
import { LogService } from './log.service';
import { ComfyUIArgsService } from './launch-options.service';
import { PluginUninstallManager } from '../plugin/uninstall';
import { PluginHistoryManager } from '../plugin/history';
import { PluginCacheManager } from '../plugin/cache';

const execPromise = promisify(exec);

export class ProcessService {
  private comfyProcess: ChildProcess | null = null;
  private startTime: Date | null = null;
  private comfyPid: number | null = null;
  private logService: LogService;
  private argsService: ComfyUIArgsService;
  
  constructor(logService: LogService, argsService?: ComfyUIArgsService) {
    this.logService = logService;
    this.argsService = argsService || new ComfyUIArgsService();

    // Container start (server start) only:
    // check and disable incompatible plugin once, not when "start ComfyUI" is called.
    this.ensureIncompatiblePluginsDisabledOnContainerStart().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[container-start-check] incompatible plugin check failed:', msg);
      this.logService.addLog(`Error in container-start incompatible plugin check: ${msg}`, true);
      i18nLogger.error('comfyui.process.container_start_disable_failed', { message: msg, lng: i18nLogger.getLocale() });
    });
  }

  /**
   * Disable incompatible plugins once at container start.
   * Must keep consistent with the "disable plugin" feature mechanism.
   */
  private async ensureIncompatiblePluginsDisabledOnContainerStart(): Promise<void> {
    const targetNeedle = 'smznodes';
    try {
      logger.info('[container-start-check] enter ensureIncompatiblePluginsDisabledOnContainerStart');

      const isDev = process.env.NODE_ENV !== 'production';
      const COMFYUI_PATH =
        process.env.COMFYUI_PATH ||
        (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

      const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');
      const DISABLED_PLUGINS_PATH = path.join(CUSTOM_NODES_PATH, '.disabled');

      logger.info('[container-start-check] COMFYUI_PATH=', COMFYUI_PATH);
      logger.info('[container-start-check] CUSTOM_NODES_PATH=', CUSTOM_NODES_PATH);
      logger.info('[container-start-check] DISABLED_PLUGINS_PATH=', DISABLED_PLUGINS_PATH);

      i18nLogger.info('comfyui.process.container_start_incompatible_check', {
        targetNeedle,
        customNodesPath: CUSTOM_NODES_PATH,
        disabledPluginsPath: DISABLED_PLUGINS_PATH,
        lng: i18nLogger.getLocale(),
      });

      const customNodesExists = fs.existsSync(CUSTOM_NODES_PATH);
      logger.info('[container-start-check] custom_nodes exists=', customNodesExists);
      if (!customNodesExists) {
        logger.info('[container-start-check] custom_nodes not found, skip');
        return;
      }

      const dirs = fs.readdirSync(CUSTOM_NODES_PATH, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        // ignore dot dirs and backups
        .filter((name) => !name.startsWith('.') && !/_backup_\d+$/i.test(name));

      logger.info('[container-start-check] enabled plugin dirs count=', dirs.length);
      logger.info('[container-start-check] enabled plugin dirs sample=', dirs.slice(0, 25));

      const candidates = dirs.filter((name) => name.toLowerCase().includes(targetNeedle));
      logger.info('[container-start-check] candidates=', candidates);
      if (!candidates.length) {
        logger.info('[container-start-check] no candidates matched, skip disable');
        return;
      }

      const historyManager = new PluginHistoryManager();
      const cacheManager = new PluginCacheManager();
      const uninstallManager = new PluginUninstallManager(historyManager, undefined, cacheManager);

      // Use the same disabling mechanism as the API
      const fakeCtx: any = { request: { ip: '127.0.0.1', headers: {} } };

      const disabledNow: string[] = [];
      for (const pluginId of candidates) {
        const regularPath = path.join(CUSTOM_NODES_PATH, pluginId);
        const disabledPath = path.join(DISABLED_PLUGINS_PATH, pluginId);
        logger.info('[container-start-check] disabling candidate pluginId=', pluginId);
        logger.info('[container-start-check] before exists: regular=', fs.existsSync(regularPath), 'disabled=', fs.existsSync(disabledPath));

        // disablePlugin 会自行处理禁用目录存在/移动等情况
        await uninstallManager.disablePlugin(fakeCtx, pluginId);
        disabledNow.push(pluginId);

        logger.info('[container-start-check] after disable: regular=', fs.existsSync(regularPath), 'disabled=', fs.existsSync(disabledPath));
      }

      const logLang = i18nLogger.getLocale();
      i18nLogger.info('comfyui.process.disabled_incompatible_plugins_container_start', {
        disabledNow,
        lng: logLang,
      });
      logger.info('[container-start-check] disabledNow=', disabledNow);
    } catch (e) {
      // Keep startup robust: don't block container start
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[container-start-check] error:', msg);
      this.logService.addLog(`Failed to auto-disable incompatible plugins: ${msg}`, true);
      i18nLogger.error('comfyui.process.disabled_incompatible_plugins_container_start_failed', {
        message: msg,
        lng: i18nLogger.getLocale(),
      });
    }
  }
  
  // Check if ComfyUI is running and capture PID if it is
  async checkIfComfyUIRunning(): Promise<void> {
    try {
      const running = await isComfyUIRunning();
      if (running) {
        // If ComfyUI is already running, find its process ID
        exec("ps aux | grep '[p]ython.*comfyui' | awk '{print $2}'", (error, stdout) => {
          if (!error && stdout.trim()) {
            const pid = parseInt(stdout.trim(), 10);
            if (!isNaN(pid)) {
              this.comfyPid = pid;
              this.startTime = new Date(); // Assume just started
              const logLang = i18nLogger.getLocale();
              i18nLogger.info('comfyui.process.detected_running', { pid, lng: logLang });
            }
          }
        });
      }
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('comfyui.process.check_error', { message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }
  
  // Start ComfyUI
  async startComfyUI(lang: string = 'zh'): Promise<{ success: boolean; message: string; pid?: number | null; logs?: string[] }> {
    i18nLogger.info('comfyui.api.start_request', { lng: lang });
    this.logService.clearLogs(); // Clear previous logs
    this.logService.addLog('收到启动ComfyUI请求', false, 'comfyui.logs.request_start');
    
    // First check if already running
    const running = await isComfyUIRunning();
    if (running) {
      this.logService.addLog('ComfyUI已经在运行中', false, 'comfyui.logs.already_running');
      const message = i18nLogger.translate('comfyui.start.already_running', { lng: lang }) || 'ComfyUI已经在运行中';
      return {
        success: false,
        message: message,
        pid: this.comfyPid
      };
    }
    
    try {
      // Build CLI arguments from launch options (persisted). If empty, fall back to process.env.CLI_ARGS
      // so Kubernetes/Deployment defaults are not wiped when spawn overwrites env.CLI_ARGS.
      let cliArgs = this.argsService.buildCliArgsString().trim();
      if (!cliArgs && process.env.CLI_ARGS) {
        cliArgs = process.env.CLI_ARGS.trim();
      }
      const argsForLog = cliArgs || '(empty)';
      this.logService.addLog(`Using CLI args: ${argsForLog}`, false, 'comfyui.logs.launch_cli_args', { args: argsForLog });
      
      // Start ComfyUI process
      this.logService.addLog('尝试启动ComfyUI进程...', false, 'comfyui.logs.attempting_start');
      this.logService.addLog(`执行命令: bash ${path.resolve('/runner-scripts/entrypoint.sh')}`, false, 'comfyui.logs.executing_command');
      
      this.comfyProcess = spawn('bash', ['/runner-scripts/entrypoint.sh'], {
        detached: false, // Process not detached, exits with main process
        stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, capture stdout and stderr
        env: {
          ...process.env,
          CLI_ARGS: cliArgs
        }
      });
      
      this.startTime = new Date();
      
      // Capture output
      if (this.comfyProcess.stdout) {
        this.comfyProcess.stdout.on('data', (data) => {
          const output = data.toString().trim();
          this.logService.addLog(`[ComfyUI] ${output}`);
          
          // Try to capture actual ComfyUI process ID from output
          const match = output.match(/ComfyUI.*启动.*pid[:\s]+(\d+)/i);
          if (match && match[1]) {
            this.comfyPid = parseInt(match[1], 10);
            this.logService.addLog(`捕获到ComfyUI真实PID: ${this.comfyPid}`, false, 'comfyui.logs.captured_pid', { 
              pid: this.comfyPid 
            });
          }
        });
      }
      
      if (this.comfyProcess.stderr) {
        this.comfyProcess.stderr.on('data', (data) => {
          const errorMsg = data.toString().trim();
          this.logService.addLog(`[ComfyUI-Error] ${errorMsg}`, true);
        });
      }
      
      // Listen for process exit
      this.comfyProcess.on('exit', (code, signal) => {
        this.logService.addLog(`启动脚本进程已退出，退出码: ${code}, 信号: ${signal}`, false, 'comfyui.logs.process_exited', {
          code: code,
          signal: signal
        });
        this.comfyProcess = null;
        
        // Check if ComfyUI is still running
        this.checkIfComfyUIRunning().then(async () => {
          const stillRunning = await isComfyUIRunning();
          if (!stillRunning) {
            this.comfyPid = null;
            this.startTime = null;
          }
        });
      });
      
      // Listen for errors
      this.comfyProcess.on('error', (err) => {
        this.logService.addLog(`启动脚本进程错误: ${err.message}`, true, 'comfyui.logs.process_error', {
          message: err.message
        });
        this.comfyProcess = null;
      });
      
      // Wait for a while to ensure process starts successfully
      let retries = 0;
      const maxRetries = 120;
      let comfyStarted = false;
      
      while (retries < maxRetries && !comfyStarted) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        comfyStarted = await isComfyUIRunning();
        
        if (comfyStarted) {
          // Get real ComfyUI process ID
          if (!this.comfyPid) {
            exec("ps aux | grep '[p]ython.*comfyui' | awk '{print $2}'", (error, stdout) => {
              if (!error && stdout.trim()) {
                this.comfyPid = parseInt(stdout.trim(), 10);
                this.logService.addLog(i18nLogger.translate('comfyui.logs.pid_found', { pid: this.comfyPid, lng: lang }), false, 'comfyui.logs.pid_found', { pid: this.comfyPid });
              }
            });
          }
          break;
        }
        
        retries++;
        this.logService.addLog(`等待ComfyUI启动，尝试 ${retries}/${maxRetries}`, false, 'comfyui.logs.waiting_startup', { 
          retry: retries, 
          maxRetries: maxRetries 
        });
      }
      
      if (comfyStarted) {
        const startMessage = i18nLogger.translate('comfyui.start.started', { lng: lang }) || 'ComfyUI已启动';
        this.logService.addLog(startMessage, false, 'comfyui.start.started');
        return {
          success: true,
          message: startMessage,
          pid: this.comfyPid
        };
      } else {
        const timeoutMessage = i18nLogger.translate('comfyui.start.failed_timeout', { lng: lang }) || 'ComfyUI启动失败或超时';
        this.logService.addLog(timeoutMessage, true, 'comfyui.start.failed_timeout');
        
        // Try to clean up startup script process
        if (this.comfyProcess && this.comfyProcess.kill) {
          this.comfyProcess.kill();
          this.comfyProcess = null;
        }
        this.startTime = null;
        
        const message = i18nLogger.translate('comfyui.start.failed_timeout', { lng: lang }) || 'ComfyUI启动失败或超时';
        return {
          success: false,
          message: message,
          logs: this.logService.getRecentLogs()
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedMessage = i18nLogger.translate('comfyui.start.failed', { message: errorMessage, lng: lang }) || `启动失败: ${errorMessage}`;
      this.logService.addLog(failedMessage, true, 'comfyui.start.failed', { message: errorMessage });
      return {
        success: false,
        message: failedMessage,
        logs: this.logService.getRecentLogs()
      };
    }
  }
  
  // Stop ComfyUI
  async stopComfyUI(lang: string = 'zh'): Promise<{ success: boolean; message: string; error?: string }> {
    i18nLogger.info('comfyui.api.stop_request', { lng: lang });
    
    try {
      // First check if really running
      const running = await isComfyUIRunning();
      if (!running) {
        i18nLogger.info('comfyui.api.already_stopped', { lng: lang });
        this.comfyPid = null;
        this.startTime = null;
        const message = i18nLogger.translate('comfyui.stop.already_stopped', { lng: lang }) || 'ComfyUI已经停止';
        return { success: true, message: message };
      }
      
      i18nLogger.info('comfyui.api.attempting_stop', { lng: lang });
      
      // Prefer using generic method to terminate
      await this.killComfyUIGeneric();
      
      // Wait enough time for process to fully terminate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Final check
      const finalCheck = await isComfyUIRunning();
      if (!finalCheck) {
        i18nLogger.info('comfyui.api.stopped', { lng: lang });
        this.comfyPid = null;
        this.startTime = null;
        const message = i18nLogger.translate('comfyui.stop.stopped', { lng: lang }) || 'ComfyUI停止成功';
        return { success: true, message: message };
      } else {
        // If first attempt didn't succeed, try again with stronger method
        i18nLogger.warn('comfyui.api.force_stop', { lng: lang });
        await execPromise('pkill -9 -f python').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const lastCheck = await isComfyUIRunning();
        if (!lastCheck) {
          i18nLogger.info('comfyui.api.stopped_force', { lng: lang });
          this.comfyPid = null;
          this.startTime = null;
          const message = i18nLogger.translate('comfyui.stop.stopped_force', { lng: lang }) || 'ComfyUI停止成功（强制）';
          return { success: true, message: message };
        } else {
          i18nLogger.error('comfyui.api.stop_failed', { lng: lang });
          const message = i18nLogger.translate('comfyui.stop.failed', { lng: lang }) || '无法停止ComfyUI';
          return { success: false, message: message, error: message };
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      i18nLogger.error('comfyui.api.stop_error', { message: errorMessage, lng: lang });
      const message = i18nLogger.translate('comfyui.stop.error', { lng: lang }) || '停止ComfyUI时发生错误';
      return { success: false, message: message, error: message };
    }
  }
  
  // Restart ComfyUI
  async restartComfyUI(lang: string = 'zh'): Promise<{ success: boolean; message: string; pid?: number | null; logs?: string[]; error?: string }> {
    i18nLogger.info('comfyui.api.restart_request', { lng: lang });
    
    try {
      // Stop ComfyUI first
      const stopResult = await this.stopComfyUI(lang);
      if (!stopResult.success) {
        const message = i18nLogger.translate('comfyui.restart.stop_failed', { lng: lang }) || '停止ComfyUI失败，无法重启';
        i18nLogger.error('comfyui.api.restart_stop_failed', { message, lng: lang });
        return { 
          success: false, 
          message: message,
          error: stopResult.error 
        };
      }
      
      // Wait a bit before starting again
      i18nLogger.info('comfyui.api.waiting_restart', { lng: lang });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Start ComfyUI again
      i18nLogger.info('comfyui.api.starting_restart', { lng: lang });
      const startResult = await this.startComfyUI(lang);
      
      if (startResult.success) {
        const message = i18nLogger.translate('comfyui.restart.restarted', { lng: lang }) || 'ComfyUI重启成功';
        i18nLogger.info('comfyui.api.restarted', { message, lng: lang });
        return {
          success: true,
          message: message,
          pid: this.comfyPid
        };
      } else {
        const message = i18nLogger.translate('comfyui.restart.start_failed', { lng: lang }) || '重启ComfyUI失败：启动阶段出错';
        i18nLogger.error('comfyui.api.restart_start_failed', { message, lng: lang });
        return {
          success: false,
          message: message,
          logs: startResult.logs,
          error: startResult.message
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      i18nLogger.error('comfyui.api.restart_error', { message: errorMessage, lng: lang });
      const message = i18nLogger.translate('comfyui.restart.error', { lng: lang }) || `重启ComfyUI失败: ${errorMessage}`;
      return {
        success: false,
        message: message,
        error: errorMessage
      };
    }
  }
  
  // Use generic method to terminate ComfyUI
  private async killComfyUIGeneric(): Promise<void> {
    try {
      // First find large Python processes (might be ComfyUI)
      const { stdout } = await execPromise("ps aux | grep python | grep -v grep | awk '{if($6>100000) print $2}'");
      const pids = stdout.trim().split('\n').filter((pid: string) => pid);
      
      if (pids.length > 0) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.info('comfyui.process.found_processes', { pids: pids.join(', '), lng: logLang });
        
        // Terminate found processes one by one
        for (const pid of pids) {
          try {
            await execPromise(`kill -9 ${pid}`);
            i18nLogger.info('comfyui.process.terminated', { pid, lng: logLang });
          } catch (e: unknown) {
            i18nLogger.warn('comfyui.process.terminate_failed', { pid, message: String(e), lng: logLang });
          }
        }
        return;
      }
    } catch (e: unknown) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('comfyui.process.find_failed', { message: String(e), lng: logLang });
    }
    
    // Fallback: use generic command
    const cmd = 'pkill -9 -f "python"';
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('comfyui.process.fallback_command', { cmd, lng: logLang });
    await execPromise(cmd).catch((e: unknown) => i18nLogger.warn('comfyui.process.fallback_failed', { message: String(e), lng: logLang }));
  }
  
  // Reset ComfyUI to initial state
  async resetComfyUI(lang: string, mode: 'normal' | 'hard' = 'normal'): Promise<{ success: boolean; message: string; logs?: string[] }> {
    logger.info(`[API] Received reset ComfyUI request (language: ${lang}, mode: ${mode})`);
    
    // Clear reset logs
    this.logService.clearResetLogs();
    
    // Also clear log file
    try {
      const logFilePath = path.join(process.cwd(), 'logs', 'comfyui-reset.log');
      if (!fs.existsSync(path.dirname(logFilePath))) {
        fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
      }
      fs.writeFileSync(logFilePath, ''); // Clear file content
    } catch (error) {
      logger.error(`Failed to clear reset log file: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Use i18n to add logs
    const startMessage = i18nLogger.translate('comfyui.reset.started', { lng: lang });
    this.logService.addResetLog('comfyui.reset.started', false, lang);
    this.logService.addLog(startMessage);
    
    // Record reset mode
    const modeMessage = mode === 'hard' 
      ? i18nLogger.translate('comfyui.reset.mode_hard', { lng: lang }) || '使用强力重置模式'
      : i18nLogger.translate('comfyui.reset.mode_normal', { lng: lang }) || '使用普通重置模式';
    this.logService.addResetLog(modeMessage);
    
    try {
      // First check if ComfyUI is running, if so stop it
      const running = await isComfyUIRunning();
      if (running) {
        const stoppingMessage = i18nLogger.translate('comfyui.reset.stopping', { lng: lang });
        this.logService.addResetLog(stoppingMessage);
        this.logService.addLog(stoppingMessage);
        await this.killComfyUIGeneric();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const stillRunning = await isComfyUIRunning();
        if (stillRunning) {
          const stopFailedMessage = i18nLogger.translate('comfyui.reset.stop_failed', { lng: lang });
          this.logService.addResetLog(stopFailedMessage, true);
          return { success: false, message: stopFailedMessage };
        }
        
        this.comfyPid = null;
        this.startTime = null;
      }
      
      // Start reset operation
      this.logService.addResetLog(i18nLogger.translate('comfyui.reset.started', { lng: lang }));
      
      // 1. Clear cache path
      if (cachePath && fs.existsSync(cachePath)) {
        const cleaningCacheMessage = i18nLogger.translate('comfyui.reset.cleaning_cache', { path: cachePath, lng: lang });
        this.logService.addResetLog(cleaningCacheMessage);
        await this.clearDirectory(cachePath);
      } else {
        const cacheNotExistMessage = i18nLogger.translate('comfyui.reset.cache_not_exist', { path: cachePath, lng: lang });
        this.logService.addResetLog(cacheNotExistMessage, true);
      }
      
      // 2. Clear content under COMFYUI_PATH, preserve different directories based on reset mode
      const comfyuiPath = paths.comfyui;
      if (comfyuiPath && fs.existsSync(comfyuiPath)) {
        const cleaningPathMessage = i18nLogger.translate('comfyui.reset.cleaning_path', { path: comfyuiPath, lng: lang });
        this.logService.addResetLog(cleaningPathMessage);
        
        // Determine list of directories to preserve
        const preservedDirs = ['models', 'output', 'input']; // Default preserved directories
        
        // Add additional preserved directories based on reset mode
        if (mode === 'normal') {
          preservedDirs.push('user', 'custom_nodes');
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.preserving_normal_dirs', { lng: lang }) || '普通模式：保留 user、models、custom_nodes 目录');
        } else {
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.preserving_hard_dirs', { lng: lang }) || '强力模式：仅保留 models 目录');
        }
        
        // Check if data directory is within comfyuiPath
        const dataDir = config.dataDir;
        const dataDirRelative = dataDir && path.relative(comfyuiPath, dataDir);
        const isDataDirInComfyUI = dataDirRelative && !dataDirRelative.startsWith('..') && !path.isAbsolute(dataDirRelative);
        
        if (isDataDirInComfyUI) {
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.data_dir_preserved', { dataDir, lng: lang }), false, lang);
          preservedDirs.push(path.basename(dataDir));
        }
        
        const entries = fs.readdirSync(comfyuiPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // Check if it's a directory that needs to be preserved
          if (preservedDirs.includes(entry.name)) {
            const keepingDirMessage = i18nLogger.translate('comfyui.reset.keeping_dir', { name: entry.name, lng: lang });
            this.logService.addResetLog(keepingDirMessage);
            continue;
          }
          
          const fullPath = path.join(comfyuiPath, entry.name);
          if (entry.isDirectory()) {
            const deletingDirMessage = i18nLogger.translate('comfyui.reset.deleting_dir', { name: entry.name, lng: lang });
            this.logService.addResetLog(deletingDirMessage);
            await this.clearDirectory(fullPath, true); // Delete entire directory
          } else {
            const deletingFileMessage = i18nLogger.translate('comfyui.reset.deleting_file', { name: entry.name, lng: lang });
            this.logService.addResetLog(deletingFileMessage);
            fs.unlinkSync(fullPath);
          }
        }
      } else {
        const pathNotExistMessage = i18nLogger.translate('comfyui.reset.path_not_exist', { path: comfyuiPath, lng: lang });
        this.logService.addResetLog(pathNotExistMessage, true);
      }
      
      // 3. Try to execute recovery script, only restart Pod if failed
      try {
        const recoveryStartedMessage = i18nLogger.translate('comfyui.reset.recovery_started', { lng: lang });
        this.logService.addResetLog(recoveryStartedMessage);
        
        // First try to execute recovery script
        try {
          await execPromise('chmod +x /runner-scripts/up-version-cp.sh');
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.script_permission', { lng: lang }), false, lang);
          
          const { stdout: upVersionOutput } = await execPromise('sh /runner-scripts/up-version-cp.sh');
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.script_result', { result: upVersionOutput.trim() || '完成', lng: lang }), false, lang);
          
          const { stdout: rsyncOutput } = await execPromise('rsync -av --update /runner-scripts/ /root/runner-scripts/');
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.rsync_result', { result: rsyncOutput.trim().split('\n')[0], lng: lang }), false, lang);
          
          const recoveryCompletedMessage = i18nLogger.translate('comfyui.reset.recovery_completed', { lng: lang });
          this.logService.addResetLog(recoveryCompletedMessage);
          
        } catch (scriptError) {
          // Recovery script execution failed, try to restart Pod
          const errorMsg = scriptError instanceof Error ? scriptError.message : String(scriptError);
          const recoveryFailedMessage = i18nLogger.translate('comfyui.reset.recovery_failed', { message: errorMsg, lng: lang });
          this.logService.addResetLog(recoveryFailedMessage, true);
        }
      } catch (cmdError) {
        const errorMsg = cmdError instanceof Error ? cmdError.message : String(cmdError);
        this.logService.addResetLog(i18nLogger.translate('comfyui.reset.recovery_error', { message: errorMsg, lng: lang }), true, lang);
        // Continue execution, don't interrupt entire reset process
      }
      
      const resetCompletedMessage = i18nLogger.translate('comfyui.reset.reset_completed', { lng: lang });
      this.logService.addResetLog(resetCompletedMessage);
      
      // Return success response
      const successMessage = i18nLogger.translate('comfyui.reset.completed', { lng: lang });
      return {
        success: true,
        message: successMessage
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedMessage = i18nLogger.translate('comfyui.reset.failed', { message: errorMessage, lng: lang });
      this.logService.addResetLog(failedMessage, true, lang);
      i18nLogger.error('comfyui.api.reset_error', { message: errorMessage, lng: lang });
      
      return {
        success: false,
        message: failedMessage,
        logs: this.logService.getResetLogs()
      };
    }
  }
  
  // Helper method: clear directory
  private async clearDirectory(dirPath: string, removeDir: boolean = false): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await this.clearDirectory(fullPath, true);
      } else {
        // Safely delete file
        try {
          fs.unlinkSync(fullPath);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.delete_file_error', { path: fullPath, message: errorMsg, lng: i18nLogger.getLocale() }), true, i18nLogger.getLocale());
        }
      }
    }
    
    // If needed, delete directory itself
    if (removeDir) {
      try {
        fs.rmdirSync(dirPath);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logService.addResetLog(i18nLogger.translate('comfyui.reset.delete_dir_error', { path: dirPath, message: errorMsg, lng: i18nLogger.getLocale() }), true, i18nLogger.getLocale());
      }
    }
  }
  
  // Clean up disabled plugins that still exist in plugin directory
  async cleanupDisabledPlugins(): Promise<void> {
    const logLang = i18nLogger.getLocale();
    try {
      const comfyuiPath = paths.comfyui;
      if (!comfyuiPath || !fs.existsSync(comfyuiPath)) {
        i18nLogger.warn('comfyui.plugin_cleanup.path_not_exist', { lng: logLang });
        return;
      }

      // Define plugin directory and disabled directory paths
      const pluginsDir = path.join(comfyuiPath, 'custom_nodes');
      const disabledDir = path.join(pluginsDir, '.disabled');

      // Check if directories exist
      if (!fs.existsSync(pluginsDir)) {
        i18nLogger.warn('comfyui.plugin_cleanup.plugins_dir_not_exist', { lng: logLang });
        return;
      }

      if (!fs.existsSync(disabledDir)) {
        i18nLogger.info('comfyui.plugin_cleanup.disabled_dir_not_exist', { lng: logLang });
        return;
      }

      i18nLogger.info('comfyui.plugin_cleanup.starting', { lng: logLang });

      // Get all plugins in disabled directory
      const disabledPlugins = fs.readdirSync(disabledDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      if (disabledPlugins.length === 0) {
        i18nLogger.info('comfyui.plugin_cleanup.no_disabled_plugins', { lng: logLang });
        return;
      }

      i18nLogger.info('comfyui.plugin_cleanup.found_disabled', { count: disabledPlugins.length, lng: logLang });

      // Check if plugin directory contains any disabled plugins
      let cleanupCount = 0;
      for (const plugin of disabledPlugins) {
        const pluginPath = path.join(pluginsDir, plugin);
        
        if (fs.existsSync(pluginPath)) {
          i18nLogger.warn('comfyui.plugin_cleanup.deleting_disabled', { plugin, lng: logLang });
          
          try {
            // Recursively delete plugin directory
            await this.clearDirectory(pluginPath, true);
            cleanupCount++;
            i18nLogger.info('comfyui.plugin_cleanup.deleted', { plugin, lng: logLang });
          } catch (error) {
            i18nLogger.error('comfyui.plugin_cleanup.delete_failed', { plugin, message: error instanceof Error ? error.message : String(error), lng: logLang });
          }
        }
      }

      if (cleanupCount > 0) {
        i18nLogger.info('comfyui.plugin_cleanup.completed', { count: cleanupCount, lng: logLang });
      } else {
        i18nLogger.info('comfyui.plugin_cleanup.no_cleanup_needed', { lng: logLang });
      }
    } catch (error) {
      i18nLogger.error('comfyui.plugin_cleanup.error', { message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }
  
  // Getters
  getComfyPid(): number | null {
    return this.comfyPid;
  }
  
  getStartTime(): Date | null {
    return this.startTime;
  }
  
  getComfyProcess(): ChildProcess | null {
    return this.comfyProcess;
  }
}
