use serde::Serialize;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use sysinfo::{Components, Disks, Networks, System};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ─── Structures ───────────────────────────────────────────────
#[derive(Serialize, Clone)]
pub struct SystemStats {
    pub cpu: u32,
    pub ram: u32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub temp: u32,
    pub disk: u32,
    pub disk_used_gb: u32,
    pub disk_total_gb: u32,
    pub cpu_cores: u32,
}

#[derive(Serialize, Clone)]
pub struct SystemInfo {
    pub os_name: String,
    pub hostname: String,
    pub cpu_brand: String,
    pub cpu_cores: u32,
    pub uptime_secs: u64,
}

#[derive(Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub memory_mb: f32,
}

#[derive(Serialize, Clone)]
pub struct NetworkStats {
    pub name:         String,
    pub bytes_sent:   u64,
    pub bytes_recv:   u64,
    pub packets_sent: u64,
    pub packets_recv: u64,
    pub send_kbs:     f32,
    pub recv_kbs:     f32,
}

#[derive(Serialize, Clone)]
pub struct TempFilesInfo {
    pub total_size_mb: f32,
    pub file_count: u32,
}

#[derive(Serialize, Clone)]
pub struct CleanResult {
    pub freed_mb: f32,
    pub files_deleted: u32,
    pub files_skipped: u32,
}

#[derive(Serialize, Clone)]
pub struct RamCleanResult {
    pub before_mb: f32,
    pub after_mb:  f32,
    pub freed_mb:  f32,
}

#[derive(Serialize, Clone)]
pub struct BenchmarkResult {
    pub cpu_score: u32,
    pub ram_score: u32,
    pub disk_score: u32,
    pub total_score: u32,
    pub duration_ms: u64,
}

struct SysState {
    sys:        Arc<Mutex<System>>,
    networks:   Mutex<(Networks, Instant)>,
    gpu:        Arc<Mutex<GpuStats>>,
    sys_cache:  Arc<Mutex<SystemStats>>,
    proc_cache: Arc<Mutex<Vec<ProcessInfo>>>,
}

// ─── Commandes Tauri ──────────────────────────────────────────

/// Stats temps réel — lit le cache mis à jour par le thread background
#[tauri::command]
fn get_system_stats(state: tauri::State<SysState>) -> SystemStats {
    state.sys_cache.lock().unwrap().clone()
}

/// Infos statiques du système (appelée une seule fois au démarrage)
#[tauri::command]
fn get_system_info(state: tauri::State<SysState>) -> SystemInfo {
    let sys = state.sys.lock().unwrap();

    let os_name    = System::name().unwrap_or_else(|| "Windows".to_string());
    let os_version = System::os_version().unwrap_or_default();
    let os_full    = if os_version.is_empty() { os_name } else { format!("{} {}", os_name, os_version) };

    let hostname  = System::host_name().unwrap_or_else(|| "PC".to_string());
    let cpu_brand = sys.cpus().first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "Processeur inconnu".to_string());
    let cpu_cores  = sys.cpus().len() as u32;
    let uptime_secs = System::uptime();

    SystemInfo { os_name: os_full, hostname, cpu_brand, cpu_cores, uptime_secs }
}

/// Liste des processus — lit le cache mis à jour toutes les 2s par le thread background
#[tauri::command]
fn get_processes(state: tauri::State<SysState>) -> Vec<ProcessInfo> {
    state.proc_cache.lock().unwrap().clone()
}

/// Statistiques réseau par interface avec débit calculé en Rust
#[tauri::command]
fn get_network_stats(state: tauri::State<SysState>) -> Vec<NetworkStats> {
    let mut lock = state.networks.lock().unwrap();
    let (ref mut networks, ref mut last_time) = *lock;

    networks.refresh();
    let now = Instant::now();
    let dt  = now.duration_since(*last_time).as_secs_f32().max(0.001);
    *last_time = now;

    let mut result: Vec<NetworkStats> = networks
        .iter()
        .filter(|(_, d)| d.total_received() > 0 || d.total_transmitted() > 0)
        .map(|(name, d)| NetworkStats {
            name:         name.clone(),
            bytes_sent:   d.total_transmitted(),
            bytes_recv:   d.total_received(),
            packets_sent: d.total_packets_transmitted(),
            packets_recv: d.total_packets_received(),
            send_kbs:     d.transmitted() as f32 / dt / 1024.0,
            recv_kbs:     d.received()    as f32 / dt / 1024.0,
        })
        .collect();

    if result.is_empty() {
        result = networks.iter().map(|(name, d)| NetworkStats {
            name: name.clone(),
            bytes_sent: d.total_transmitted(), bytes_recv: d.total_received(),
            packets_sent: d.total_packets_transmitted(), packets_recv: d.total_packets_received(),
            send_kbs: 0.0, recv_kbs: 0.0,
        }).collect();
    }

    result.sort_by(|a, b| (b.recv_kbs + b.send_kbs).partial_cmp(&(a.recv_kbs + a.send_kbs)).unwrap_or(std::cmp::Ordering::Equal));
    result.truncate(8);
    result
}

/// Analyse les fichiers temporaires sans les supprimer
#[tauri::command]
fn get_temp_files_info() -> TempFilesInfo {
    let mut dirs: Vec<String> = vec![
        std::env::var("TEMP").unwrap_or_default(),
        std::env::var("TMP").unwrap_or_default(),
    ];
    dirs.sort();
    dirs.dedup();
    dirs.retain(|s| !s.is_empty());

    let mut total_bytes: u64 = 0;
    let mut file_count: u32  = 0;

    for dir in &dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        total_bytes += meta.len();
                        file_count  += 1;
                    }
                }
            }
        }
    }

    TempFilesInfo {
        total_size_mb: total_bytes as f32 / 1_048_576.0,
        file_count,
    }
}

/// Supprime les fichiers temporaires accessibles
#[tauri::command]
fn clean_temp_files() -> CleanResult {
    let mut dirs: Vec<String> = vec![
        std::env::var("TEMP").unwrap_or_default(),
        std::env::var("TMP").unwrap_or_default(),
    ];
    dirs.sort();
    dirs.dedup();
    dirs.retain(|s| !s.is_empty());

    let mut freed_bytes:   u64 = 0;
    let mut files_deleted: u32 = 0;
    let mut files_skipped: u32 = 0;

    for dir in &dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        let size = meta.len();
                        match std::fs::remove_file(entry.path()) {
                            Ok(_)  => { freed_bytes += size; files_deleted += 1; }
                            Err(_) => { files_skipped += 1; }
                        }
                    }
                }
            }
        }
    }

    CleanResult {
        freed_mb: freed_bytes as f32 / 1_048_576.0,
        files_deleted,
        files_skipped,
    }
}

/// Benchmark synthétique CPU + RAM + Disque
#[tauri::command]
fn run_benchmark() -> BenchmarkResult {
    use std::time::Instant;
    let start = Instant::now();

    // ── CPU : calcul flottant intensif ──
    let t0 = Instant::now();
    let mut acc: f64 = 1.0;
    for i in 0u64..1_500_000 {
        acc = acc.mul_add(1.000_001, (i as f64).sqrt() * 1e-9);
    }
    std::hint::black_box(acc);
    let cpu_ms = t0.elapsed().as_millis() as u32;

    // ── RAM : allocation séquentielle + lecture ──
    let t1 = Instant::now();
    let size = 4_000_000usize;
    let mut data: Vec<u64> = vec![0u64; size];
    for (i, v) in data.iter_mut().enumerate() {
        *v = (i as u64)
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
    }
    let chk: u64 = data.iter().step_by(512).fold(0u64, |acc, &x| acc.wrapping_add(x));
    std::hint::black_box(chk);
    drop(data);
    let ram_ms = t1.elapsed().as_millis() as u32;

    // ── Disque : ratio d'espace libre ──
    let disks = Disks::new_with_refreshed_list();
    let free_ratio = disks
        .iter()
        .filter(|d| {
            let mp = d.mount_point().to_string_lossy();
            mp.starts_with('C') || mp == "/"
        })
        .map(|d| d.available_space() as f64 / d.total_space().max(1) as f64)
        .next()
        .unwrap_or(0.5);
    let disk_score = (35.0 + free_ratio * 60.0) as u32;

    // Normalisation : cpu_ms ≤80 → 100, ≥600 → 20
    let cpu_score = if cpu_ms <= 80 { 100 }
        else if cpu_ms >= 600 { 20 }
        else { 100 - ((cpu_ms - 80) as f32 / 520.0 * 80.0) as u32 };

    // ram_ms ≤25 → 100, ≥250 → 20
    let ram_score = if ram_ms <= 25 { 100 }
        else if ram_ms >= 250 { 20 }
        else { 100 - ((ram_ms - 25) as f32 / 225.0 * 80.0) as u32 };

    let total_score = (cpu_score * 2 + ram_score * 2 + disk_score) / 5;

    BenchmarkResult {
        cpu_score,
        ram_score,
        disk_score,
        total_score,
        duration_ms: start.elapsed().as_millis() as u64,
    }
}

/// Stats GPU (NVIDIA via nvidia-smi, sinon WMI)
#[derive(Serialize, Clone)]
pub struct GpuStats {
    pub name:          String,
    pub usage:         u32,
    pub temp:          u32,
    pub vram_used_mb:  u32,
    pub vram_total_mb: u32,
}

fn ps_out(script: &str) -> String {
    #[cfg(windows)]
    {
        Command::new("powershell")
            .args(["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(not(windows))]
    { let _ = script; String::new() }
}

/// Interroge le GPU directement (appelé depuis le thread background)
fn fetch_gpu_inner() -> GpuStats {
    // 1. NVIDIA — nvidia-smi
    #[cfg(windows)]
    if let Ok(o) = Command::new("nvidia-smi")
        .args(["--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
               "--format=csv,noheader,nounits"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if o.status.success() {
            let line = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let p: Vec<&str> = line.splitn(5, ',').map(|s| s.trim()).collect();
            if p.len() >= 5 {
                return GpuStats {
                    name:          p[0].to_string(),
                    usage:         p[1].parse().unwrap_or(0),
                    temp:          p[2].parse().unwrap_or(0),
                    vram_used_mb:  p[3].parse().unwrap_or(0),
                    vram_total_mb: p[4].parse().unwrap_or(0),
                };
            }
        }
    }

    // 2. Fallback WMI — nom + usage (pas de temp)
    let out = ps_out(r#"
$vc = Get-WmiObject Win32_VideoController -EA SilentlyContinue | Select -First 1
if (!$vc) { "GPU|0|0|0|0"; exit }
$name = $vc.Caption
$adRam = [int]($vc.AdapterRAM / 1MB)
$usage = try {
    $wmi = Get-WmiObject -NS 'root\cimv2' -Class Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -EA Stop
    [int](($wmi | Where Name -match '3D' | Measure UtilizationPercentage -Average).Average)
} catch { 0 }
"$name|$usage|0|0|$adRam"
"#);
    let p: Vec<&str> = out.splitn(5, '|').collect();
    if p.len() >= 5 {
        return GpuStats {
            name:          p[0].to_string(),
            usage:         p[1].parse().unwrap_or(0),
            temp:          0,
            vram_used_mb:  p[3].parse().unwrap_or(0),
            vram_total_mb: p[4].parse().unwrap_or(0),
        };
    }

    GpuStats { name: "GPU".to_string(), usage: 0, temp: 0, vram_used_mb: 0, vram_total_mb: 0 }
}

/// Lit les stats GPU depuis le cache mis à jour toutes les 2s par le thread background
#[tauri::command]
fn get_gpu_stats(state: tauri::State<SysState>) -> GpuStats {
    state.gpu.lock().unwrap().clone()
}

/// Mesure le ping réel via connexion TCP à 1.1.1.1:80
#[tauri::command]
fn measure_ping() -> u32 {
    use std::net::TcpStream;
    use std::time::Instant;
    let addr = "1.1.1.1:80".parse().unwrap();
    let t = Instant::now();
    match TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(3)) {
        Ok(_)  => t.elapsed().as_millis() as u32,
        Err(_) => 0,
    }
}

// ─── Structures tweaks ───────────────────────────────────────
#[derive(Serialize, Clone)]
pub struct TweakResult {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct TweakStatus {
    pub id: String,
    pub active: bool,
}

// ─── Helper PowerShell ───────────────────────────────────────
fn run_ps(script: &str) -> bool {
    #[cfg(windows)]
    {
        Command::new("powershell")
            .args(["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    { let _ = script; false }
}

/// Applique un tweak système via PowerShell
#[tauri::command]
fn apply_tweak(id: String) -> TweakResult {
    let ok = match id.as_str() {
        "power"    => run_ps("powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"),
        "visual"   => run_ps("$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p VisualFXSetting 2 -Type DWord -Force"),
        "gamebar"  => run_ps("$k='HKCU:\\Software\\Microsoft\\GameBar'; if(!(Test-Path $k)){New-Item $k -Force|Out-Null}; Set-ItemProperty $k AllowAutoGameMode 0 -Type DWord -Force; Set-ItemProperty $k AutoGameModeEnabled 0 -Type DWord -Force"),
        "network"  => run_ps("netsh int tcp set global autotuninglevel=normal; try{Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' TcpAckFrequency 1 -Type DWord -Force -EA Stop}catch{}"),
        "sysmain"  => run_ps("try{Stop-Service SysMain -Force -EA SilentlyContinue}catch{}; Set-Service SysMain -StartupType Disabled"),
        "priority" => run_ps("Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' Win32PrioritySeparation 38 -Type DWord -Force"),
        "wsearch"  => run_ps("try{Stop-Service WSearch -Force -EA SilentlyContinue}catch{}; Set-Service WSearch -StartupType Disabled"),
        "gamemode" => run_ps("$k='HKCU:\\Software\\Microsoft\\GameBar'; if(!(Test-Path $k)){New-Item $k -Force|Out-Null}; Set-ItemProperty $k AllowAutoGameMode 1 -Type DWord -Force; Set-ItemProperty $k AutoGameModeEnabled 1 -Type DWord -Force"),
        // ── FPS Boost ──
        "hags"             => run_ps("$p='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p HwSchMode 2 -Type DWord -Force"),
        "core_parking"     => run_ps("powercfg -setacvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 0cc5b647-c1df-4637-891a-dec35c318583 100; powercfg -setdcvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 0cc5b647-c1df-4637-891a-dec35c318583 100; powercfg -s SCHEME_CURRENT"),
        "power_throttling" => run_ps("$p='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p PowerThrottlingOff 1 -Type DWord -Force"),
        "timer_res"        => run_ps("bcdedit /set useplatformtick yes; bcdedit /set disabledynamictick no"),
        // ── Latence ──
        "nagle"            => run_ps("Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces' -EA SilentlyContinue | ForEach-Object { Set-ItemProperty $_.PSPath TcpAckFrequency 1 -Type DWord -Force -EA SilentlyContinue; Set-ItemProperty $_.PSPath TCPNoDelay 1 -Type DWord -Force -EA SilentlyContinue }"),
        "network_throttle" => run_ps("Set-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' NetworkThrottlingIndex 0xFFFFFFFF -Type DWord -Force"),
        "mmcss"            => run_ps("$k='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games'; if(!(Test-Path $k)){New-Item $k -Force|Out-Null}; Set-ItemProperty $k Priority 6 -Type DWord -Force; Set-ItemProperty $k 'Scheduling Category' 'High' -Force; Set-ItemProperty $k 'SFIO Priority' 'High' -Force"),
        "dynamic_tick"     => run_ps("bcdedit /set disabledynamictick yes"),
        // ── Réseau ──
        "dns_fast"         => run_ps("Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | ForEach-Object { try { Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ServerAddresses '1.1.1.1','8.8.8.8' -EA SilentlyContinue } catch {} }"),
        "qos"              => run_ps("$k='HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched'; if(!(Test-Path $k)){New-Item $k -Force|Out-Null}; Set-ItemProperty $k NonBestEffortLimit 0 -Type DWord -Force"),
        "lso"              => run_ps("Get-NetAdapterAdvancedProperty -EA SilentlyContinue | Where-Object { $_.RegistryKeyword -like '*LsoV2*' } | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -RegistryKeyword $_.RegistryKeyword -RegistryValue 0 -EA SilentlyContinue } catch {} }"),
        // ── Clavier & Souris ──
        "mouse_accel"      => run_ps("$p='HKCU:\\Control Panel\\Mouse'; Set-ItemProperty $p MouseSpeed '0' -Force; Set-ItemProperty $p MouseThreshold1 '0' -Force; Set-ItemProperty $p MouseThreshold2 '0' -Force"),
        "mouse_raw"        => run_ps("$p='HKLM:\\SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p MouseDataQueueSize 20 -Type DWord -Force"),
        "keyboard_speed"   => run_ps("Set-ItemProperty 'HKCU:\\Control Panel\\Keyboard' KeyboardSpeed '31' -Force; Set-ItemProperty 'HKCU:\\Control Panel\\Keyboard' KeyboardDelay '0' -Force"),
        "keyboard_buffer"  => run_ps("$p='HKLM:\\SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p KeyboardDataQueueSize 20 -Type DWord -Force"),
        // ── Services Windows ──
        "xbox_services"    => run_ps("@('XblGameSave','XboxNetApiSvc','XboxGipSvc','XblAuthManager') | ForEach-Object { try{Stop-Service $_ -Force -EA SilentlyContinue}catch{}; try{Set-Service $_ -StartupType Disabled -EA SilentlyContinue}catch{} }"),
        "diagtrack"        => run_ps("try{Stop-Service DiagTrack -Force -EA SilentlyContinue}catch{}; try{Set-Service DiagTrack -StartupType Disabled -EA SilentlyContinue}catch{}; $p='HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p AllowTelemetry 0 -Type DWord -Force"),
        // ── Alimentation ──
        "ultimate_performance" => run_ps("$guid='e9a42b02-d5df-448d-aa00-03f14749eb61'; $list=(powercfg /list 2>&1|Out-String); if($list -match $guid){ powercfg /setactive $guid }else{ $out=(powercfg /duplicatescheme $guid 2>&1|Out-String); if($out -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'){ powercfg /setactive $matches[1] } }; (powercfg /getactivescheme) -match $guid"),
        // ── FPS avancés ──
        "msi_mode" => run_ps(r#"$ok=$true; try { $disp=Get-PnpDevice -Class Display -EA Stop|Where-Object{$_.Status -eq 'OK'}; foreach($d in $disp){$p="HKLM:\SYSTEM\CurrentControlSet\Enum\$($d.InstanceId)\Device Parameters\Interrupt Management\MessageSignaledInterruptProperties"; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p MSISupported 1 -Type DWord -Force} } catch{$ok=$false}; try { $nets=Get-PnpDevice -Class Net -EA Stop|Where-Object{$_.Status -eq 'OK'}; foreach($n in $nets){$p="HKLM:\SYSTEM\CurrentControlSet\Enum\$($n.InstanceId)\Device Parameters\Interrupt Management\MessageSignaledInterruptProperties"; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p MSISupported 1 -Type DWord -Force} } catch{$ok=$false}; $ok"#),
        "c_states" => run_ps("powercfg -setacvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 5d76a2ca-e8c0-402f-a133-2158492d58ad 1; powercfg -setdcvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 5d76a2ca-e8c0-402f-a133-2158492d58ad 1; powercfg -s SCHEME_CURRENT"),
        // ── GPU NVIDIA ──
        "nvidia_low_latency" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; $k=Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{(Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop)-like '*NVIDIA*'}catch{$false}}|Select-Object -First 1; if($k){Set-ItemProperty $k.PSPath 'D3DPrerenderedFrames' 0 -Type DWord -Force; Set-ItemProperty $k.PSPath 'PerfLevelSrc' 0x2222 -Type DWord -Force; $true}else{$false}"#),
        "nvidia_threaded_opt" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; $k=Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{(Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop)-like '*NVIDIA*'}catch{$false}}|Select-Object -First 1; if($k){Set-ItemProperty $k.PSPath 'OGLThreadControl' 0 -Type DWord -Force; $true}else{$false}"#),
        "nvidia_shader_cache" => run_ps(r#"$p='HKLM:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p DirectXUserGlobalSettings 'ShaderCache=EnabledGlobally;' -Force; $true"#),
        // ── GPU AMD ──
        "amd_ulps" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; $ks=Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{$d=Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop;$d -like '*AMD*'-or $d -like '*Radeon*'-or $d -like '*ATI*'}catch{$false}}; foreach($k in $ks){Set-ItemProperty $k.PSPath 'EnableUlps' 0 -Type DWord -Force}; ($ks|Measure-Object).Count -gt 0"#),
        "amd_anti_lag" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; $ks=Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{$d=Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop;$d -like '*AMD*'-or $d -like '*Radeon*'-or $d -like '*ATI*'}catch{$false}}; foreach($k in $ks){Set-ItemProperty $k.PSPath 'PP_SclkDeepSleepDisable' 1 -Type DWord -Force; Set-ItemProperty $k.PSPath 'AmdPowerXpressRequestHighPerformance' 1 -Type DWord -Force}; ($ks|Measure-Object).Count -gt 0"#),
        // ── Defender ──
        "defender_realtime" => run_ps("Set-MpPreference -DisableRealtimeMonitoring $true -EA SilentlyContinue; $true"),
        _ => false,
    };
    TweakResult {
        success: ok,
        message: if ok {
            format!("Tweak '{}' appliqué avec succès", id)
        } else {
            format!("Échec du tweak '{}' — droits admin requis ?", id)
        },
    }
}

/// Annule un tweak système
#[tauri::command]
fn revert_tweak(id: String) -> TweakResult {
    let ok = match id.as_str() {
        "power"    => run_ps("powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e"),
        "visual"   => run_ps("$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects'; if(!(Test-Path $p)){New-Item $p -Force|Out-Null}; Set-ItemProperty $p VisualFXSetting 0 -Type DWord -Force"),
        "gamebar"  => run_ps("$k='HKCU:\\Software\\Microsoft\\GameBar'; if(!(Test-Path $k)){New-Item $k -Force|Out-Null}; Set-ItemProperty $k AllowAutoGameMode 1 -Type DWord -Force; Set-ItemProperty $k AutoGameModeEnabled 1 -Type DWord -Force"),
        "network"  => run_ps("netsh int tcp set global autotuninglevel=normal; try{Remove-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' TcpAckFrequency -Force -EA Stop}catch{}"),
        "sysmain"  => run_ps("Set-Service SysMain -StartupType Automatic; try{Start-Service SysMain -EA Stop}catch{}"),
        "priority" => run_ps("Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' Win32PrioritySeparation 2 -Type DWord -Force"),
        "wsearch"  => run_ps("Set-Service WSearch -StartupType Manual; try{Start-Service WSearch -EA Stop}catch{}"),
        "gamemode" => run_ps("$k='HKCU:\\Software\\Microsoft\\GameBar'; if(!(Test-Path $k)){New-Item $k -Force|Out-Null}; Set-ItemProperty $k AllowAutoGameMode 0 -Type DWord -Force; Set-ItemProperty $k AutoGameModeEnabled 0 -Type DWord -Force"),
        // ── FPS Boost ──
        "hags"             => run_ps("Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' HwSchMode 1 -Type DWord -Force"),
        "core_parking"     => run_ps("powercfg -setacvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 0cc5b647-c1df-4637-891a-dec35c318583 0; powercfg -setdcvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 0cc5b647-c1df-4637-891a-dec35c318583 0; powercfg -s SCHEME_CURRENT"),
        "power_throttling" => run_ps("try{Remove-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling' PowerThrottlingOff -Force -EA Stop}catch{}"),
        "timer_res"        => run_ps("bcdedit /deletevalue useplatformtick; bcdedit /set disabledynamictick no"),
        // ── Latence ──
        "nagle"            => run_ps("Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces' -EA SilentlyContinue | ForEach-Object { Remove-ItemProperty $_.PSPath TcpAckFrequency -Force -EA SilentlyContinue; Remove-ItemProperty $_.PSPath TCPNoDelay -Force -EA SilentlyContinue }"),
        "network_throttle" => run_ps("Set-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' NetworkThrottlingIndex 10 -Type DWord -Force"),
        "mmcss"            => run_ps("$k='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games'; if(!(Test-Path $k)){New-Item $k -Force|Out-Null}; Set-ItemProperty $k Priority 2 -Type DWord -Force; Set-ItemProperty $k 'Scheduling Category' 'Medium' -Force; Set-ItemProperty $k 'SFIO Priority' 'Normal' -Force"),
        "dynamic_tick"     => run_ps("bcdedit /set disabledynamictick no"),
        // ── Réseau ──
        "dns_fast"         => run_ps("Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | ForEach-Object { try { Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ResetServerAddresses -EA SilentlyContinue } catch {} }"),
        "qos"              => run_ps("try{Remove-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched' NonBestEffortLimit -Force -EA Stop}catch{}"),
        "lso"              => run_ps("Get-NetAdapterAdvancedProperty -EA SilentlyContinue | Where-Object { $_.RegistryKeyword -like '*LsoV2*' } | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -RegistryKeyword $_.RegistryKeyword -RegistryValue 1 -EA SilentlyContinue } catch {} }"),
        // ── Clavier & Souris ──
        "mouse_accel"      => run_ps("$p='HKCU:\\Control Panel\\Mouse'; Set-ItemProperty $p MouseSpeed '1' -Force; Set-ItemProperty $p MouseThreshold1 '6' -Force; Set-ItemProperty $p MouseThreshold2 '10' -Force"),
        "mouse_raw"        => run_ps("try{Remove-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters' MouseDataQueueSize -Force -EA Stop}catch{}"),
        "keyboard_speed"   => run_ps("Set-ItemProperty 'HKCU:\\Control Panel\\Keyboard' KeyboardSpeed '20' -Force; Set-ItemProperty 'HKCU:\\Control Panel\\Keyboard' KeyboardDelay '1' -Force"),
        "keyboard_buffer"  => run_ps("try{Remove-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters' KeyboardDataQueueSize -Force -EA Stop}catch{}"),
        // ── Services Windows ──
        "xbox_services"    => run_ps("@('XblGameSave','XboxNetApiSvc','XboxGipSvc','XblAuthManager') | ForEach-Object { try{Set-Service $_ -StartupType Manual -EA SilentlyContinue}catch{} }"),
        "diagtrack"        => run_ps("try{Set-Service DiagTrack -StartupType Automatic -EA SilentlyContinue; Start-Service DiagTrack -EA SilentlyContinue}catch{}"),
        // ── Alimentation ──
        "ultimate_performance" => run_ps("powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"),
        // ── FPS avancés ──
        "msi_mode" => run_ps(r#"$ok=$true; try{$disp=Get-PnpDevice -Class Display -EA Stop|Where-Object{$_.Status -eq 'OK'}; foreach($d in $disp){$p="HKLM:\SYSTEM\CurrentControlSet\Enum\$($d.InstanceId)\Device Parameters\Interrupt Management\MessageSignaledInterruptProperties"; try{Set-ItemProperty $p MSISupported 0 -Type DWord -Force -EA Stop}catch{}}}catch{$ok=$false}; try{$nets=Get-PnpDevice -Class Net -EA Stop|Where-Object{$_.Status -eq 'OK'}; foreach($n in $nets){$p="HKLM:\SYSTEM\CurrentControlSet\Enum\$($n.InstanceId)\Device Parameters\Interrupt Management\MessageSignaledInterruptProperties"; try{Set-ItemProperty $p MSISupported 0 -Type DWord -Force -EA Stop}catch{}}}catch{$ok=$false}; $ok"#),
        "c_states" => run_ps("powercfg -setacvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 5d76a2ca-e8c0-402f-a133-2158492d58ad 0; powercfg -setdcvalueindex SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 5d76a2ca-e8c0-402f-a133-2158492d58ad 0; powercfg -s SCHEME_CURRENT"),
        // ── GPU NVIDIA ──
        "nvidia_low_latency" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; $k=Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{(Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop)-like '*NVIDIA*'}catch{$false}}|Select-Object -First 1; if($k){try{Remove-ItemProperty $k.PSPath 'D3DPrerenderedFrames' -Force -EA Stop}catch{}; try{Remove-ItemProperty $k.PSPath 'PerfLevelSrc' -Force -EA Stop}catch{}}; $true"#),
        "nvidia_threaded_opt" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; $k=Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{(Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop)-like '*NVIDIA*'}catch{$false}}|Select-Object -First 1; if($k){try{Remove-ItemProperty $k.PSPath 'OGLThreadControl' -Force -EA Stop}catch{}}; $true"#),
        "nvidia_shader_cache" => run_ps(r#"try{Remove-ItemProperty 'HKLM:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences' DirectXUserGlobalSettings -Force -EA Stop}catch{}; $true"#),
        // ── GPU AMD ──
        "amd_ulps" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{$d=Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop;$d -like '*AMD*'-or $d -like '*Radeon*'-or $d -like '*ATI*'}catch{$false}}|ForEach-Object{Set-ItemProperty $_.PSPath 'EnableUlps' 1 -Type DWord -Force}; $true"#),
        "amd_anti_lag" => run_ps(r#"$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; Get-ChildItem $cls -EA SilentlyContinue|Where-Object{try{$d=Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop;$d -like '*AMD*'-or $d -like '*Radeon*'-or $d -like '*ATI*'}catch{$false}}|ForEach-Object{try{Remove-ItemProperty $_.PSPath 'PP_SclkDeepSleepDisable' -Force -EA Stop}catch{}; try{Remove-ItemProperty $_.PSPath 'AmdPowerXpressRequestHighPerformance' -Force -EA Stop}catch{}}; $true"#),
        // ── Defender ──
        "defender_realtime" => run_ps("Set-MpPreference -DisableRealtimeMonitoring $false -EA SilentlyContinue; $true"),
        _ => false,
    };
    TweakResult {
        success: ok,
        message: if ok {
            format!("Tweak '{}' désactivé", id)
        } else {
            format!("Échec désactivation '{}' — droits admin requis ?", id)
        },
    }
}

/// Vérifie l'état réel de chaque tweak (session PowerShell unique)
#[tauri::command]
fn get_tweaks_status() -> Vec<TweakStatus> {
    let script = r#"
$r=[ordered]@{}
# ── Existants ──
$r.power=(powercfg /getactivescheme)-match '8c5e7fda'
$r.visual=try{(Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' VisualFXSetting -EA Stop)-eq 2}catch{$false}
$r.gamebar=try{(Get-ItemPropertyValue 'HKCU:\Software\Microsoft\GameBar' AllowAutoGameMode -EA Stop)-eq 0}catch{$false}
$r.network=$false;try{$r.network=((netsh int tcp show global)-join '')-match 'normal'}catch{}
$r.sysmain=(Get-Service SysMain -EA SilentlyContinue).StartType -eq 'Disabled'
$r.priority=try{(Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl' Win32PrioritySeparation -EA Stop)-eq 38}catch{$false}
$r.wsearch=(Get-Service WSearch -EA SilentlyContinue).StartType -eq 'Disabled'
$r.gamemode=try{(Get-ItemPropertyValue 'HKCU:\Software\Microsoft\GameBar' AutoGameModeEnabled -EA Stop)-eq 1}catch{$false}
# ── FPS Boost ──
$r.hags=try{(Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' HwSchMode -EA Stop)-eq 2}catch{$false}
$r.core_parking=$false;try{$out=(powercfg -q SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 0cc5b647-c1df-4637-891a-dec35c318583 2>&1)-join ' ';$r.core_parking=$out -match '0x00000064'}catch{}
$r.power_throttling=try{(Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling' PowerThrottlingOff -EA Stop)-eq 1}catch{$false}
$r.timer_res=$false;try{$bcd=(bcdedit /enum '{current}' 2>&1)-join ' ';$r.timer_res=[bool]($bcd -match 'useplatformtick\s+Yes')}catch{}
# ── Latence ──
$r.nagle=$false;try{$i=(Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces' -EA Stop|Select -First 1);$r.nagle=(Get-ItemPropertyValue $i.PSPath TCPNoDelay -EA Stop)-eq 1}catch{}
$r.network_throttle=try{(Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile' NetworkThrottlingIndex -EA Stop)-eq 4294967295}catch{$false}
$r.mmcss=try{(Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games' Priority -EA Stop)-eq 6}catch{$false}
$r.dynamic_tick=$false;try{$bcd=(bcdedit /enum '{current}' 2>&1)-join ' ';$r.dynamic_tick=[bool]($bcd -match 'disabledynamictick\s+Yes')}catch{}
# ── Réseau ──
$r.dns_fast=$false;try{$a=Get-NetAdapter|Where-Object{$_.Status -eq 'Up'}|Select -First 1;if($a){$dns=(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -EA Stop).ServerAddresses;$r.dns_fast=$dns -contains '1.1.1.1'}}catch{}
$r.qos=try{(Get-ItemPropertyValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Psched' NonBestEffortLimit -EA Stop)-eq 0}catch{$false}
$r.lso=$false;try{$p=Get-NetAdapterAdvancedProperty -EA Stop|Where-Object{$_.RegistryKeyword -like '*LsoV2*'}|Select -First 1;$r.lso=$p -and $p.RegistryValue -eq 0}catch{}
# ── Clavier & Souris ──
$r.mouse_accel=try{(Get-ItemPropertyValue 'HKCU:\Control Panel\Mouse' MouseSpeed -EA Stop)-eq '0'}catch{$false}
$r.mouse_raw=try{(Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Services\mouclass\Parameters' MouseDataQueueSize -EA Stop)-eq 20}catch{$false}
$r.keyboard_speed=try{(Get-ItemPropertyValue 'HKCU:\Control Panel\Keyboard' KeyboardSpeed -EA Stop)-eq '31'}catch{$false}
$r.keyboard_buffer=try{(Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Services\kbdclass\Parameters' KeyboardDataQueueSize -EA Stop)-eq 20}catch{$false}
# ── Services ──
$r.xbox_services=(Get-Service XblGameSave -EA SilentlyContinue).StartType -eq 'Disabled'
$r.diagtrack=(Get-Service DiagTrack -EA SilentlyContinue).StartType -eq 'Disabled'
# ── Alimentation ──
$guid='e9a42b02-d5df-448d-aa00-03f14749eb61'
$r.ultimate_performance=$false;try{$active=(powercfg /getactivescheme 2>&1|Out-String);$list=(powercfg /list 2>&1|Out-String);$r.ultimate_performance=($list -match $guid)-and($active -match $guid)}catch{}
# ── FPS avancés ──
$r.msi_mode=$false;try{$d=Get-PnpDevice -Class Display -Status OK -EA Stop|Select-Object -First 1;if($d){$p="HKLM:\SYSTEM\CurrentControlSet\Enum\$($d.InstanceId)\Device Parameters\Interrupt Management\MessageSignaledInterruptProperties";$r.msi_mode=try{(Get-ItemPropertyValue $p MSISupported -EA Stop)-eq 1}catch{$false}}}catch{}
$r.c_states=$false;try{$out=(powercfg -q SCHEME_CURRENT 54533251-82be-4824-96c1-47b60b740d00 5d76a2ca-e8c0-402f-a133-2158492d58ad 2>&1)-join ' ';$r.c_states=$out -match '0x00000001'}catch{}
# ── GPU NVIDIA ──
$r.nvidia_low_latency=$false;try{$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}';$k=Get-ChildItem $cls -EA Stop|Where-Object{try{(Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop)-like '*NVIDIA*'}catch{$false}}|Select-Object -First 1;if($k){$r.nvidia_low_latency=try{(Get-ItemPropertyValue $k.PSPath 'D3DPrerenderedFrames' -EA Stop)-eq 0}catch{$false}}}catch{}
$r.nvidia_threaded_opt=$false;try{$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}';$k=Get-ChildItem $cls -EA Stop|Where-Object{try{(Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop)-like '*NVIDIA*'}catch{$false}}|Select-Object -First 1;if($k){$r.nvidia_threaded_opt=try{(Get-ItemPropertyValue $k.PSPath 'OGLThreadControl' -EA Stop)-eq 0}catch{$false}}}catch{}
$r.nvidia_shader_cache=$false;try{$v=Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences' DirectXUserGlobalSettings -EA Stop;$r.nvidia_shader_cache=$v -like '*EnabledGlobally*'}catch{}
# ── GPU AMD ──
$r.amd_ulps=$false;try{$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}';$k=Get-ChildItem $cls -EA Stop|Where-Object{try{$d=Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop;$d -like '*AMD*'-or $d -like '*Radeon*'-or $d -like '*ATI*'}catch{$false}}|Select-Object -First 1;if($k){$r.amd_ulps=try{(Get-ItemPropertyValue $k.PSPath 'EnableUlps' -EA Stop)-eq 0}catch{$false}}}catch{}
$r.amd_anti_lag=$false;try{$cls='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}';$k=Get-ChildItem $cls -EA Stop|Where-Object{try{$d=Get-ItemPropertyValue $_.PSPath 'DriverDesc' -EA Stop;$d -like '*AMD*'-or $d -like '*Radeon*'-or $d -like '*ATI*'}catch{$false}}|Select-Object -First 1;if($k){$r.amd_anti_lag=try{(Get-ItemPropertyValue $k.PSPath 'AmdPowerXpressRequestHighPerformance' -EA Stop)-eq 1}catch{$false}}}catch{}
# ── Defender ──
$r.defender_realtime=$false;try{$pref=Get-MpPreference -EA Stop;$r.defender_realtime=$pref.DisableRealtimeMonitoring -eq $true}catch{}
$r|ConvertTo-Json -Compress
"#;

    #[cfg(windows)]
    {
        if let Ok(o) = Command::new("powershell")
            .args(["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let json = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&json) {
                return map.into_iter()
                    .map(|(id, val)| TweakStatus { id, active: val.as_bool().unwrap_or(false) })
                    .collect();
            }
        }
    }
    #[cfg(not(windows))]
    { let _ = script; }

    ["power","visual","gamebar","network","sysmain","priority","wsearch","gamemode",
     "hags","core_parking","power_throttling","timer_res","msi_mode","c_states",
     "nagle","network_throttle","mmcss","dynamic_tick",
     "dns_fast","qos","lso",
     "mouse_accel","mouse_raw","keyboard_speed","keyboard_buffer",
     "nvidia_low_latency","nvidia_threaded_opt","nvidia_shader_cache",
     "amd_ulps","amd_anti_lag",
     "xbox_services","diagtrack","defender_realtime","ultimate_performance"]
        .iter()
        .map(|id| TweakStatus { id: id.to_string(), active: false })
        .collect()
}

// ─── Mémoire virtuelle ───────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct VirtualMemoryInfo {
    pub ram_total_gb:   f32,
    pub is_auto:        bool,
    pub min_mb:         u32,
    pub max_mb:         u32,
}

#[tauri::command]
fn get_virtual_memory_info(state: tauri::State<SysState>) -> VirtualMemoryInfo {
    let ram_total_gb = state.sys_cache.lock().unwrap().ram_total_gb;
    let out = ps_out(r#"
$cs = Get-WmiObject Win32_ComputerSystem -EA SilentlyContinue
$pf = Get-WmiObject Win32_PageFileSetting -EA SilentlyContinue | Select-Object -First 1
$auto = if ($cs) { [string]$cs.AutomaticManagedPagefile } else { 'True' }
$min  = if ($pf) { $pf.InitialSize } else { 0 }
$max  = if ($pf) { $pf.MaximumSize } else { 0 }
"$auto|$min|$max"
"#);
    let parts: Vec<&str> = out.split('|').collect();
    if parts.len() >= 3 {
        return VirtualMemoryInfo {
            ram_total_gb,
            is_auto: parts[0].trim().to_lowercase() != "false",
            min_mb:  parts[1].trim().parse().unwrap_or(0),
            max_mb:  parts[2].trim().parse().unwrap_or(0),
        };
    }
    VirtualMemoryInfo { ram_total_gb, is_auto: true, min_mb: 0, max_mb: 0 }
}

#[tauri::command]
fn set_virtual_memory(optimize: bool) -> bool {
    if optimize {
        run_ps(r#"
$ramMB = [int]((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
$minMB = [int]($ramMB * 1.5); $maxMB = [int]($ramMB * 3)
$cs = Get-WmiObject Win32_ComputerSystem; $cs.AutomaticManagedPagefile = $false; $cs.Put() | Out-Null
Get-WmiObject Win32_PageFileSetting | ForEach-Object { $_.Delete() | Out-Null }
$pf = ([WMIClass]"Win32_PageFileSetting").CreateInstance()
$pf.Name = "$env:SystemDrive\pagefile.sys"; $pf.InitialSize = $minMB; $pf.MaximumSize = $maxMB
$pf.Put() | Out-Null; $true
"#)
    } else {
        run_ps(r#"$cs = Get-WmiObject Win32_ComputerSystem; $cs.AutomaticManagedPagefile = $true; $cs.Put() | Out-Null; $true"#)
    }
}

// ─── Auto-Boost Gaming Session ───────────────────────────────

#[derive(Serialize, Clone)]
pub struct AutoBoostResult {
    pub game_detected:     bool,
    pub game_name:         String,
    pub processes_boosted: u32,
}

#[tauri::command]
fn auto_boost_session(state: tauri::State<SysState>) -> AutoBoostResult {
    let game_patterns: &[&str] = &[
        "steam", "epicgameslauncher", "riotclient", "battle.net", "origin", "upc", "galaxyclient",
        "minecraft", "fortnite", "valorant", "cs2", "csgo", "leagueoflegends",
        "dota2", "overwatch", "gta5", "gtav", "rocketleague", "apexlegends",
        "warzone", "pubg-win", "rustclient", "r6siege", "eft", "valorant",
    ];

    let procs = state.proc_cache.lock().unwrap().clone();
    let game_procs: Vec<&ProcessInfo> = procs.iter()
        .filter(|p| {
            let n = p.name.to_lowercase();
            game_patterns.iter().any(|pat| n.contains(pat))
        })
        .collect();

    if game_procs.is_empty() {
        return AutoBoostResult { game_detected: false, game_name: String::new(), processes_boosted: 0 };
    }

    let game_name = game_procs.first().map(|p| p.name.clone()).unwrap_or_default();
    let pids_str  = game_procs.iter().map(|p| p.pid.to_string()).collect::<Vec<_>>().join(",");

    // Boost priorité + nettoyer RAM
    let script = format!(
        r#"@({pids}) | ForEach-Object {{ try {{ (Get-Process -Id $_ -EA Stop).PriorityClass = 'High' }} catch {{}} }}
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public class RCB {{ [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h); public static void Clean() {{ foreach(var p in Process.GetProcesses()) {{ try {{ RCB.EmptyWorkingSet(p.Handle); }} catch {{}} }} }} }}
'@
[RCB]::Clean() | Out-Null"#,
        pids = pids_str
    );
    run_ps(&script);

    AutoBoostResult { game_detected: true, game_name, processes_boosted: game_procs.len() as u32 }
}

#[tauri::command]
fn boost_game_processes(install_path: String) -> u32 {
    let safe = install_path.to_lowercase().replace('\'', "''");
    let script = format!(
        r#"$c=0; Get-Process -EA SilentlyContinue | ForEach-Object {{ try {{ $e=$_.MainModule.FileName; if($e -and $e.ToLower().StartsWith('{safe}')){{ $_.PriorityClass='High'; $c++ }} }} catch {{}} }}; $c"#
    );
    ps_out(&script).trim().parse::<u32>().unwrap_or(0)
}

// ─── CleanDisk (Nettoyage Windows) ───────────────────────────

#[tauri::command]
fn run_cleandisk() -> bool {
    run_ps(r#"Start-Process cleanmgr.exe -ArgumentList '/sagerun:1' -Wait -EA SilentlyContinue; $true"#)
}

/// Fonction partagée : calcule les SystemStats depuis un System déjà verrouillé
fn compute_sys_stats(s: &System) -> SystemStats {
    let cpu       = s.global_cpu_usage().round() as u32;
    let cpu_cores = s.cpus().len() as u32;
    let total_mem = s.total_memory();
    let used_mem  = s.used_memory();
    let ram = if total_mem > 0 {
        (used_mem as f64 / total_mem as f64 * 100.0).round() as u32
    } else { 0 };
    let ram_used_gb  = (used_mem  as f32 / 1_073_741_824.0 * 10.0).round() / 10.0;
    let ram_total_gb = (total_mem as f32 / 1_073_741_824.0 * 10.0).round() / 10.0;

    let components = Components::new_with_refreshed_list();
    let temp_f32 = components.iter()
        .filter(|c| {
            let lbl = c.label().to_lowercase();
            lbl.contains("cpu") || lbl.contains("core") || lbl.contains("tctl")
                || lbl.contains("package") || lbl.contains("k10temp") || lbl.contains("coretemp")
        })
        .map(|c| c.temperature())
        .filter(|t| !t.is_nan() && *t > 0.0)
        .fold(0.0_f32, f32::max);
    let temp = if temp_f32 > 0.0 { temp_f32.round() as u32 } else { 0 };

    let disks = Disks::new_with_refreshed_list();
    let (disk_used, disk_total) = disks.iter()
        .filter(|d| { let mp = d.mount_point().to_string_lossy(); mp.starts_with('C') || mp == "/" })
        .map(|d| (d.total_space().saturating_sub(d.available_space()), d.total_space()))
        .next()
        .unwrap_or((0, 1));
    let disk          = (disk_used as f64 / disk_total as f64 * 100.0).round() as u32;
    let disk_used_gb  = (disk_used  / 1_073_741_824) as u32;
    let disk_total_gb = (disk_total / 1_073_741_824) as u32;

    SystemStats { cpu, ram, ram_used_gb, ram_total_gb, temp, disk, disk_used_gb, disk_total_gb, cpu_cores }
}

// ─── Admin ───────────────────────────────────────────────────

/// Vérifie si l'application tourne avec des droits administrateur
#[tauri::command]
fn is_admin() -> bool {
    #[cfg(windows)]
    {
        Command::new("net")
            .args(["session"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    { false }
}

/// Relance l'application avec élévation UAC puis quitte le processus actuel
#[tauri::command]
fn relaunch_as_admin() -> bool {
    #[cfg(windows)]
    {
        let exe = match std::env::current_exe() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => return false,
        };
        let script = format!(
            "Start-Process -FilePath '{}' -Verb RunAs -WindowStyle Hidden",
            exe.replace('\'', "''")
        );
        let ok = run_ps(&script);
        if ok {
            std::process::exit(0);
        }
        ok
    }
    #[cfg(not(windows))]
    { false }
}

// ─── Programmes de démarrage ─────────────────────────────────

#[derive(Serialize, Clone)]
pub struct StartupProgram {
    pub name:     String,
    pub command:  String,
    pub location: String, // "HKCU" | "HKLM"
    pub enabled:  bool,
}

#[tauri::command]
fn get_startup_programs() -> Vec<StartupProgram> {
    let script = r#"
$out = @()
function Get-StartupItems($regPath, $loc) {
    if (!(Test-Path $regPath)) { return }
    $items = Get-ItemProperty $regPath -EA SilentlyContinue
    if (!$items) { return }
    $items | Get-Member -MemberType NoteProperty |
    Where-Object { $_.Name -notin @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') } |
    ForEach-Object {
        $name = $_.Name
        $cmd  = "$($items.$name)"
        $saPath = $regPath -replace '\\Run$','\Explorer\StartupApproved\Run'
        $enabled = $true
        try {
            $bytes = Get-ItemPropertyValue $saPath $name -EA Stop
            if ($bytes -and $bytes[0] -eq 3) { $enabled = $false }
        } catch {}
        $script:out += ("{0}|{1}|{2}|{3}" -f $name, $cmd, $loc, $enabled)
    }
}
Get-StartupItems 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' 'HKCU'
Get-StartupItems 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' 'HKLM'
$out -join "`n"
"#;
    ps_out(script)
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let p: Vec<&str> = line.splitn(4, '|').collect();
            if p.len() == 4 {
                Some(StartupProgram {
                    name:     p[0].to_string(),
                    command:  p[1].to_string(),
                    location: p[2].to_string(),
                    enabled:  p[3].trim().to_lowercase() == "true",
                })
            } else { None }
        })
        .collect()
}

#[tauri::command]
fn toggle_startup_program(name: String, location: String, enable: bool) -> bool {
    let sa = if location == "HKCU" {
        r"HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
    } else {
        r"HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
    };
    let byte = if enable { "0x02" } else { "0x03" };
    let script = format!(
        r#"$p='{sa}'; if(!(Test-Path $p)){{New-Item $p -Force|Out-Null}}; $b=[byte[]](@({byte})+(@(0)*11)); Set-ItemProperty $p '{name}' $b -Type Binary -Force"#,
        sa    = sa,
        byte  = byte,
        name  = name.replace('\'', "''"),
    );
    run_ps(&script)
}

// ─── Catégories de nettoyage avancé ──────────────────────────

#[derive(Serialize, Clone)]
pub struct CleanCategory {
    pub id:             String,
    pub label:          String,
    pub size_mb:        f32,
    pub file_count:     u32,
    pub requires_admin: bool,
}

/// Chemin du dossier Temp de l'utilisateur courant, fiable même sous élévation UAC.
/// `%TEMP%` peut pointer vers le profil système après `Start-Process -Verb RunAs`,
/// donc on préfère `%LOCALAPPDATA%\Temp` qui reste dans le profil utilisateur réel.
fn user_temp() -> String {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = format!("{local}\\Temp");
        if std::path::Path::new(&p).exists() {
            return p;
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = format!("{profile}\\AppData\\Local\\Temp");
        if std::path::Path::new(&p).exists() {
            return p;
        }
    }
    std::env::var("TEMP").unwrap_or_default()
}

fn dir_info(path: &str) -> (f32, u32) {
    fn walk(p: &std::path::Path) -> (u64, u32) {
        let mut b = 0u64; let mut c = 0u32;
        if let Ok(entries) = std::fs::read_dir(p) {
            for e in entries.flatten() {
                if let Ok(m) = e.metadata() {
                    if m.is_file()      { b += m.len(); c += 1; }
                    else if m.is_dir() { let (db, dc) = walk(&e.path()); b += db; c += dc; }
                }
            }
        }
        (b, c)
    }
    let (b, c) = walk(std::path::Path::new(path));
    (b as f32 / 1_048_576.0, c)
}

/// Vérifie si un fichier peut réellement être supprimé (non verrouillé exclusivement).
/// Ouvre avec l'accès DELETE + partage complet — échoue si un process tient le fichier
/// sans FILE_SHARE_DELETE.
#[cfg(windows)]
fn is_deletable(path: &std::path::Path) -> bool {
    std::fs::OpenOptions::new()
        .access_mode(0x00010000) // DELETE
        .share_mode(0x00000007)  // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        .open(path)
        .is_ok()
}

/// Comme dir_info mais ne compte que les fichiers qu'on peut effectivement supprimer.
fn dir_info_deletable(path: &str) -> (f32, u32) {
    fn walk(p: &std::path::Path) -> (u64, u32) {
        let mut b = 0u64; let mut c = 0u32;
        if let Ok(entries) = std::fs::read_dir(p) {
            for e in entries.flatten() {
                if let Ok(m) = e.metadata() {
                    if m.is_file() {
                        #[cfg(windows)]
                        { if is_deletable(&e.path()) { b += m.len(); c += 1; } }
                        #[cfg(not(windows))]
                        { b += m.len(); c += 1; }
                    } else if m.is_dir() {
                        let (db, dc) = walk(&e.path());
                        b += db; c += dc;
                    }
                }
            }
        }
        (b, c)
    }
    let (b, c) = walk(std::path::Path::new(path));
    (b as f32 / 1_048_576.0, c)
}

#[tauri::command]
fn get_clean_categories() -> Vec<CleanCategory> {
    let tmp     = user_temp();
    let local   = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();

    // Vignettes Windows — seulement les thumbcache_*.db
    let thumb_path = format!("{local}\\Microsoft\\Windows\\Explorer");
    let (thumb_mb, thumb_count) = {
        let mut b = 0u64; let mut c = 0u32;
        if let Ok(entries) = std::fs::read_dir(&thumb_path) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("thumbcache_") {
                    if let Ok(m) = e.metadata() { if m.is_file() { b += m.len(); c += 1; } }
                }
            }
        }
        (b as f32 / 1_048_576.0, c)
    };

    macro_rules! cat {
        ($id:expr, $label:expr, $path:expr, $admin:expr) => {{
            let (s, n) = dir_info($path);
            CleanCategory { id: $id.into(), label: $label.into(), size_mb: s, file_count: n, requires_admin: $admin }
        }};
    }

    let mut cats = vec![
        {
            // dir_info_deletable : ne compte que les fichiers réellement supprimables
            // (non verrouillés par un autre process) — évite d'afficher des MB fantômes
            let (s, n) = dir_info_deletable(&tmp);
            CleanCategory { id: "temp_user".into(), label: "Temp utilisateur".into(), size_mb: s, file_count: n, requires_admin: false }
        },
        cat!("temp_windows",   "Temp Windows",           r"C:\Windows\Temp",                                            true),
        cat!("prefetch",       "Cache Prefetch",         r"C:\Windows\Prefetch",                                        true),
        cat!("windows_update", "Windows Update cache",   r"C:\Windows\SoftwareDistribution\Download",                   true),
        cat!("chrome",         "Cache Chrome",           &format!("{local}\\Google\\Chrome\\User Data\\Default\\Cache"), false),
        cat!("edge",           "Cache Edge",             &format!("{local}\\Microsoft\\Edge\\User Data\\Default\\Cache"), false),
        cat!("firefox",        "Cache Firefox",          &format!("{appdata}\\Mozilla\\Firefox\\Profiles"),              false),
        CleanCategory { id: "thumbnails".into(), label: "Vignettes Windows".into(), size_mb: thumb_mb, file_count: thumb_count, requires_admin: false },
    ];

    // Cache Brave
    let brave_p = format!("{local}\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache");
    let (bs, bn) = dir_info(&brave_p);
    if bn > 0 {
        cats.push(CleanCategory { id: "brave".into(), label: "Cache Brave".into(), size_mb: bs, file_count: bn, requires_admin: false });
    }

    // Cache DirectX Shader
    let dx_p = format!("{local}\\D3DSCache");
    let (dxs, dxn) = dir_info(&dx_p);
    cats.push(CleanCategory { id: "dx_cache".into(), label: "Cache Shader DirectX".into(), size_mb: dxs, file_count: dxn, requires_admin: false });

    // Cache NVIDIA
    let (ns1, nn1) = dir_info(&format!("{local}\\NVIDIA\\DXCache"));
    let (ns2, nn2) = dir_info(&format!("{local}\\NVIDIA\\GLCache"));
    if ns1 + ns2 > 0.0 || nn1 + nn2 > 0 {
        cats.push(CleanCategory { id: "nvidia_cache".into(), label: "Cache GPU NVIDIA".into(), size_mb: ns1 + ns2, file_count: nn1 + nn2, requires_admin: false });
    }

    // Cache AMD
    let (ams, amn) = dir_info(&format!("{local}\\AMD\\DxCache"));
    if ams > 0.0 || amn > 0 {
        cats.push(CleanCategory { id: "amd_cache".into(), label: "Cache GPU AMD".into(), size_mb: ams, file_count: amn, requires_admin: false });
    }

    // Rapports d'erreurs Windows (WER)
    let (wers, wern) = dir_info(&format!("{local}\\Microsoft\\Windows\\WER\\ReportArchive"));
    cats.push(CleanCategory { id: "wer".into(), label: "Rapports d'erreurs Windows".into(), size_mb: wers, file_count: wern, requires_admin: false });

    // Fichiers récents
    let (recs, recn) = dir_info(&format!("{appdata}\\Microsoft\\Windows\\Recent"));
    cats.push(CleanCategory { id: "recent".into(), label: "Fichiers récents".into(), size_mb: recs, file_count: recn, requires_admin: false });

    cats
}

fn clean_path_recursive(p: &std::path::Path) -> (u64, u32, u32) {
    let mut freed = 0u64; let mut del = 0u32; let mut skip = 0u32;
    if let Ok(entries) = std::fs::read_dir(p) {
        for e in entries.flatten() {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    match std::fs::remove_file(e.path()) {
                        Ok(_)  => { freed += m.len(); del += 1; }
                        Err(_) => { skip += 1; }
                    }
                } else if m.is_dir() {
                    let (b, d, s) = clean_path_recursive(&e.path());
                    freed += b; del += d; skip += s;
                }
            }
        }
    }
    (freed, del, skip)
}

#[tauri::command]
fn clean_categories(categories: Vec<String>) -> CleanResult {
    let mut freed_bytes: u64 = 0;
    let mut files_deleted: u32 = 0;
    let mut files_skipped: u32 = 0;
    let local   = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();

    macro_rules! clean_rec {
        ($path:expr) => {{
            let (f, d, s) = clean_path_recursive(std::path::Path::new($path));
            freed_bytes += f; files_deleted += d; files_skipped += s;
        }};
    }

    for cat in &categories {
        match cat.as_str() {
            "temp_user" => {
                // Script one-liner : mesure avant, supprime, mesure après
                // Parse en f64 car PowerShell retourne des doubles (ex: "1234567.0")
                let t = user_temp().replace('\'', "''");
                let script = format!(
                    "$b=(gci '{t}\\*' -r -fo -ea 0|measure -p Length -s).Sum;if(-not $b){{$b=0}};gci '{t}\\*' -fo -ea 0|ri -r -fo -ea 0;$a=(gci '{t}\\*' -r -fo -ea 0|measure -p Length -s).Sum;if(-not $a){{$a=0}};[Math]::Max(0,$b-$a)"
                );
                let freed_b = ps_out(&script).trim().parse::<f64>().unwrap_or(0.0) as u64;
                freed_bytes   += freed_b;
                if freed_b > 0 { files_deleted += 1; }
            }
            "temp_windows"   => clean_rec!(r"C:\Windows\Temp"),
            "prefetch"       => clean_rec!(r"C:\Windows\Prefetch"),
            "windows_update" => clean_rec!(r"C:\Windows\SoftwareDistribution\Download"),
            "chrome"  => clean_rec!(&format!("{local}\\Google\\Chrome\\User Data\\Default\\Cache")),
            "edge"    => clean_rec!(&format!("{local}\\Microsoft\\Edge\\User Data\\Default\\Cache")),
            "firefox" => clean_rec!(&format!("{appdata}\\Mozilla\\Firefox\\Profiles")),
            "brave"   => clean_rec!(&format!("{local}\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache")),
            "thumbnails" => {
                let path = format!("{local}\\Microsoft\\Windows\\Explorer");
                if let Ok(entries) = std::fs::read_dir(&path) {
                    for e in entries.flatten() {
                        let n = e.file_name().to_string_lossy().to_string();
                        if n.starts_with("thumbcache_") {
                            if let Ok(m) = e.metadata() {
                                if m.is_file() {
                                    match std::fs::remove_file(e.path()) {
                                        Ok(_)  => { freed_bytes += m.len(); files_deleted += 1; }
                                        Err(_) => { files_skipped += 1; }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "dx_cache"     => clean_rec!(&format!("{local}\\D3DSCache")),
            "nvidia_cache" => {
                clean_rec!(&format!("{local}\\NVIDIA\\DXCache"));
                clean_rec!(&format!("{local}\\NVIDIA\\GLCache"));
            }
            "amd_cache"    => clean_rec!(&format!("{local}\\AMD\\DxCache")),
            "wer"          => clean_rec!(&format!("{local}\\Microsoft\\Windows\\WER\\ReportArchive")),
            "recent"       => clean_rec!(&format!("{appdata}\\Microsoft\\Windows\\Recent")),
            _ => {}
        }
    }
    CleanResult { freed_mb: freed_bytes as f32 / 1_048_576.0, files_deleted, files_skipped }
}

#[tauri::command]
fn clean_ram() -> Result<RamCleanResult, String> {
    let script = r#"
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
public class RamCleaner {
    [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr handle);
    public static int Clean() {
        int count = 0;
        foreach (var p in Process.GetProcesses()) {
            try { EmptyWorkingSet(p.Handle); count++; } catch {}
        }
        return count;
    }
}
'@
[RamCleaner]::Clean() | Out-Null
"#;
    // Mesure avant
    let mut sys = System::new_all();
    sys.refresh_memory();
    let before_bytes = sys.used_memory();
    let before_mb = before_bytes as f32 / 1_048_576.0;

    let _ = run_ps(script);

    // Mesure après (laisser le temps au kernel de récupérer les pages)
    std::thread::sleep(std::time::Duration::from_millis(1200));
    sys.refresh_memory();
    let after_bytes = sys.used_memory();
    let after_mb = after_bytes as f32 / 1_048_576.0;

    let freed_mb = if before_bytes > after_bytes {
        (before_bytes - after_bytes) as f32 / 1_048_576.0
    } else {
        0.0
    };

    Ok(RamCleanResult { before_mb, after_mb, freed_mb })
}

#[tauri::command]
fn flush_dns() -> Result<String, String> {
    run_ps("Clear-DnsClientCache");
    Ok("Cache DNS vidé".to_string())
}

#[tauri::command]
fn empty_recycle_bin() -> Result<CleanResult, String> {
    // Mesure la corbeille avant
    let size_script = r#"
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(0xA)
$total = 0
foreach ($item in $bin.Items()) { $total += $item.Size }
$total
"#;
    let size_before: u64 = ps_out(size_script).trim().parse().unwrap_or(0);

    run_ps("Clear-RecycleBin -Force -ErrorAction SilentlyContinue");

    let freed_mb = size_before as f32 / 1_048_576.0;
    Ok(CleanResult { freed_mb, files_deleted: 0, files_skipped: 0 })
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<String, String> {
    let script = format!("Stop-Process -Id {} -Force -ErrorAction SilentlyContinue", pid);
    run_ps(&script);
    Ok(format!("Processus {} terminé", pid))
}

// ─── Jeux installés ──────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct InstalledGame {
    pub name:         String,
    pub platform:     String,
    pub install_path: String,
    pub size_gb:      f32,
}

fn parse_acf_value(content: &str, key: &str) -> String {
    let search = format!("\"{}\"", key);
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with(&search) {
            // "key"\t\t"value"  →  split by `"` → index 3
            let parts: Vec<&str> = t.split('"').collect();
            if parts.len() >= 4 { return parts[3].to_string(); }
        }
    }
    String::new()
}

#[tauri::command]
fn get_installed_games() -> Vec<InstalledGame> {
    let mut games: Vec<InstalledGame> = Vec::new();

    // ── Steam ──
    for base in &[
        r"C:\Program Files (x86)\Steam\steamapps",
        r"C:\Program Files\Steam\steamapps",
    ] {
        if let Ok(entries) = std::fs::read_dir(base) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) == Some("acf") {
                    if let Ok(content) = std::fs::read_to_string(&p) {
                        let name        = parse_acf_value(&content, "name");
                        let install_dir = parse_acf_value(&content, "installdir");
                        let size_bytes  = parse_acf_value(&content, "SizeOnDisk")
                            .parse::<u64>().unwrap_or(0);
                        if !name.is_empty() {
                            games.push(InstalledGame {
                                name,
                                platform: "Steam".to_string(),
                                install_path: format!("{}\\{}", base, install_dir),
                                size_gb: (size_bytes as f32 / 1_073_741_824.0 * 10.0).round() / 10.0,
                            });
                        }
                    }
                }
            }
        }
    }

    // ── Epic Games ──
    let epic = r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests";
    if let Ok(entries) = std::fs::read_dir(epic) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("item") {
                if let Ok(content) = std::fs::read_to_string(&p) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        let name  = json["DisplayName"].as_str().unwrap_or("").to_string();
                        let ipath = json["InstallLocation"].as_str().unwrap_or("").to_string();
                        let size  = json["InstallSize"].as_u64().unwrap_or(0);
                        if !name.is_empty() {
                            games.push(InstalledGame {
                                name,
                                platform: "Epic".to_string(),
                                install_path: ipath,
                                size_gb: (size as f32 / 1_073_741_824.0 * 10.0).round() / 10.0,
                            });
                        }
                    }
                }
            }
        }
    }

    games.sort_by(|a, b| a.name.cmp(&b.name));
    games
}

// ─── Overlay mini-mode ───────────────────────────────────────

#[tauri::command]
async fn open_overlay(app: tauri::AppHandle) -> bool {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.show();
        let _ = w.set_focus();
        return true;
    }
    WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("/#overlay".into()))
        .title("OptiPC Overlay")
        .inner_size(240.0, 180.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .is_ok()
}

// ─── Entry point ─────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let networks = Networks::new_with_refreshed_list();

    // Arc partagé entre le thread stats et les commandes
    let sys = Arc::new(Mutex::new(System::new_all()));

    // Cache stats système — mis à jour toutes les ~1s par le thread background
    let sys_cache = Arc::new(Mutex::new(SystemStats {
        cpu: 0, ram: 0, ram_used_gb: 0.0, ram_total_gb: 0.0,
        temp: 0, disk: 0, disk_used_gb: 0, disk_total_gb: 0, cpu_cores: 0,
    }));

    // Cache processus — mis à jour toutes les ~2s (deux refresh avec délai pour CPU stable)
    let proc_cache: Arc<Mutex<Vec<ProcessInfo>>> = Arc::new(Mutex::new(Vec::new()));

    // Thread background : stats système + processus
    // CPU nécessite 2 appels refresh séparés par un délai pour mesurer le delta d'usage
    {
        let sys_bg    = Arc::clone(&sys);
        let cache_bg  = Arc::clone(&sys_cache);
        let procs_bg  = Arc::clone(&proc_cache);
        std::thread::spawn(move || {
            let mut tick: u32 = 0;
            loop {
                // 1er appel : établit la baseline CPU (système + processus)
                {
                    let mut s = sys_bg.lock().unwrap();
                    s.refresh_cpu_usage();
                    if tick % 4 == 0 {
                        s.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(500));

                // 2e appel : mesure le delta → valeur réelle
                {
                    let mut s = sys_bg.lock().unwrap();
                    s.refresh_cpu_usage();
                    s.refresh_memory();
                    *cache_bg.lock().unwrap() = compute_sys_stats(&s);

                    // Mise à jour processus toutes les ~2s (tick pair)
                    if tick % 4 == 0 {
                        s.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                        let mut procs: Vec<ProcessInfo> = s
                            .processes()
                            .values()
                            .map(|p| ProcessInfo {
                                pid:       p.pid().as_u32(),
                                name:      p.name().to_string_lossy().into_owned(),
                                cpu:       p.cpu_usage(),
                                memory_mb: p.memory() as f32 / 1_048_576.0,
                            })
                            .collect();
                        procs.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal));
                        *procs_bg.lock().unwrap() = procs;
                    }
                }

                std::thread::sleep(std::time::Duration::from_millis(500));
                tick = tick.wrapping_add(1);
            }
        });
    }

    // Thread background : interroge le GPU toutes les 2s
    let gpu_arc = Arc::new(Mutex::new(GpuStats {
        name: "GPU".to_string(),
        usage: 0, temp: 0, vram_used_mb: 0, vram_total_mb: 0,
    }));
    let gpu_clone = Arc::clone(&gpu_arc);
    std::thread::spawn(move || loop {
        *gpu_clone.lock().unwrap() = fetch_gpu_inner();
        std::thread::sleep(std::time::Duration::from_secs(2));
    });

    tauri::Builder::default()
        .manage(SysState {
            sys,
            networks:   Mutex::new((networks, Instant::now())),
            gpu:        gpu_arc,
            sys_cache,
            proc_cache,
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            get_system_info,
            get_processes,
            get_network_stats,
            get_temp_files_info,
            clean_temp_files,
            run_benchmark,
            apply_tweak,
            revert_tweak,
            get_tweaks_status,
            measure_ping,
            get_gpu_stats,
            get_startup_programs,
            toggle_startup_program,
            get_clean_categories,
            clean_categories,
            clean_ram,
            flush_dns,
            empty_recycle_bin,
            kill_process,
            get_installed_games,
            open_overlay,
            is_admin,
            relaunch_as_admin,
            get_virtual_memory_info,
            set_virtual_memory,
            auto_boost_session,
            boost_game_processes,
            run_cleandisk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
