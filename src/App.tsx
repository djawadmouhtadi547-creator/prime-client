import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountSummary, AppSettings, BuildReport, JavaInfo, MinecraftVersion, ModFile, Profile, SourceReport, TaskProgress } from '../shared/types';

type Page = 'home' | 'library' | 'versions' | 'mods' | 'performance' | 'downloads' | 'settings' | 'accounts' | 'source';
type Notice = { kind: 'success' | 'error' | 'info'; message: string } | null;

const labels: Record<Page, string> = {
  home: 'Home', library: 'Library', versions: 'Versions', mods: 'Mods', performance: 'Performance',
  downloads: 'Downloads', settings: 'Settings', accounts: 'Accounts', source: 'Source Build'
};
const arabicLabels: Record<Page, string> = {
  home: 'الرئيسية', library: 'المكتبة', versions: 'الإصدارات', mods: 'التعديلات', performance: 'الأداء',
  downloads: 'التنزيلات', settings: 'الإعدادات', accounts: 'الحسابات', source: 'بناء المود'
};
const navItems: Array<{ id: Page; glyph: string; group: string }> = [
  { id: 'home', glyph: '⌂', group: 'PLAY' },
  { id: 'library', glyph: '▤', group: 'PLAY' },
  { id: 'versions', glyph: '◷', group: 'GAME' },
  { id: 'mods', glyph: '✣', group: 'GAME' },
  { id: 'performance', glyph: '↗', group: 'GAME' },
  { id: 'downloads', glyph: '↓', group: 'SYSTEM' },
  { id: 'source', glyph: '⌘', group: 'SYSTEM' },
  { id: 'accounts', glyph: '◉', group: 'PREFERENCES' },
  { id: 'settings', glyph: '⚙', group: 'PREFERENCES' }
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDate(input?: string): string {
  if (!input) return '—';
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [versionsCached, setVersionsCached] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [versionSearch, setVersionSearch] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [installed, setInstalled] = useState<string[]>([]);
  const [mods, setMods] = useState<ModFile[]>([]);
  const [javaList, setJavaList] = useState<JavaInfo[]>([]);
  const [progressList, setProgressList] = useState<TaskProgress[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [createName, setCreateName] = useState('');
  const [searchingVersions, setSearchingVersions] = useState(false);
  const [sourceReport, setSourceReport] = useState<SourceReport | null>(null);
  const [buildReport, setBuildReport] = useState<BuildReport | null>(null);
  const [showBuildConfirm, setShowBuildConfirm] = useState(false);
  const [gameStatus, setGameStatus] = useState<{ running: boolean; profileId: string | null; pid: number | null }>({ running: false, profileId: null, pid: null });

  const isArabic = settings?.locale === 'ar';
  const currentProfile = useMemo(() => profiles.find((p) => p.id === settings?.defaultProfileId) ?? profiles[0] ?? null, [profiles, settings?.defaultProfileId]);
  const t = (english: string, arabic: string) => isArabic ? arabic : english;

  const refreshProfiles = useCallback(async () => {
    const [nextProfiles, nextSettings] = await Promise.all([window.prime.listProfiles(), window.prime.getSettings()]);
    setProfiles(nextProfiles);
    setSettings(nextSettings);
  }, []);
  const refreshInstalled = useCallback(async () => {
    if (!currentProfile) { setInstalled([]); return; }
    try { setInstalled(await window.prime.listInstalledVersions(currentProfile.id)); } catch { setInstalled([]); }
  }, [currentProfile]);
  const refreshMods = useCallback(async () => {
    if (!currentProfile) { setMods([]); return; }
    try { setMods(await window.prime.listMods(currentProfile.id)); } catch { setNotice({ kind: 'error', message: 'Could not read this profile’s mods folder.' }); }
  }, [currentProfile]);
  const refreshVersions = useCallback(async (force = false) => {
    setSearchingVersions(true);
    setVersionsError('');
    try {
      const result = await window.prime.listVersions(force);
      setVersions(result.versions);
      setVersionsCached(result.cached);
      setVersionsError(result.error ?? '');
      if (!selectedVersion) setSelectedVersion(result.versions.find((v) => v.type === 'release')?.id ?? result.versions[0]?.id ?? '');
      if (!result.versions.length && result.error) setNotice({ kind: 'error', message: result.error });
    } catch (error) {
      setVersionsError(error instanceof Error ? error.message : 'Could not load versions.');
    } finally { setSearchingVersions(false); }
  }, [selectedVersion]);

  useEffect(() => {
    void Promise.all([refreshProfiles(), window.prime.getAccount(), window.prime.detectJava(), window.prime.gameStatus()])
      .then(([, currentAccount, detectedJava, status]) => { setAccount(currentAccount); setJavaList(detectedJava); setGameStatus(status); })
      .catch((error: unknown) => setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Startup failed.' }));
  }, [refreshProfiles]);
  useEffect(() => window.prime.onTaskProgress((progress) => {
    setProgressList((old) => [progress, ...old.filter((item) => item.taskId !== progress.taskId)].slice(0, 40));
  }), []);
  useEffect(() => { void refreshInstalled(); }, [refreshInstalled]);
  useEffect(() => { if (page === 'mods' || page === 'home') void refreshMods(); }, [page, refreshMods]);
  useEffect(() => { if (page === 'versions' && versions.length === 0 && !searchingVersions) void refreshVersions(false); }, [page, versions.length, searchingVersions, refreshVersions]);
  useEffect(() => {
    const interval = window.setInterval(() => { void window.prime.gameStatus().then(setGameStatus).catch(() => undefined); }, 4000);
    return () => window.clearInterval(interval);
  }, []);

  const run = useCallback(async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await operation();
      if (success) setNotice({ kind: 'success', message: success });
      return result;
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'The operation failed.' });
      return null;
    } finally { setBusy(false); }
  }, []);

  const updateSettings = async (patch: Partial<AppSettings>, success?: string) => {
    const result = await run(() => window.prime.saveSettings(patch), success) as AppSettings | null;
    if (result) setSettings(result);
  };
  const updateCurrentProfile = async (patch: Partial<Pick<Profile, 'name' | 'versionId' | 'loader' | 'javaPath' | 'minMemoryMb' | 'maxMemoryMb'>>) => {
    if (!currentProfile) return;
    const updated = await run(() => window.prime.updateProfile(currentProfile.id, patch), 'Profile settings saved.') as Profile | null;
    if (updated) setProfiles((old) => old.map((profile) => profile.id === updated.id ? updated : profile));
  };
  const chooseProfile = async (id: string) => {
    const result = await run(() => window.prime.selectProfile(id), 'Active profile changed.');
    if (result !== null) await refreshProfiles();
  };
  const createProfile = async () => {
    const created = await run(() => window.prime.createProfile(createName), 'Profile created.') as Profile | null;
    if (created) { setCreateName(''); await refreshProfiles(); await window.prime.selectProfile(created.id); await refreshProfiles(); setPage('library'); }
  };
  const runInstall = async () => {
    if (!currentProfile || !selectedVersion) return;
    await run(() => window.prime.installVersion(currentProfile.id, selectedVersion), `Installed Minecraft ${selectedVersion}.`);
    await refreshInstalled();
  };
  const play = async () => {
    if (!currentProfile) return;
    const response = await run(() => window.prime.launchGame(currentProfile.id)) as { ok: boolean; message: string } | null;
    if (response?.ok) setNotice({ kind: 'success', message: response.message });
  };
  const chooseJava = async () => {
    const info = await run(() => window.prime.chooseJava()) as JavaInfo | null;
    if (info) { setJavaList((old) => [info, ...old.filter((item) => item.path !== info.path)]); await refreshProfiles(); setNotice({ kind: 'success', message: `Java ${info.major} selected: ${info.path}` }); }
  };
  const importModFiles = async () => {
    if (!currentProfile) return;
    const result = await run(() => window.prime.importMods(currentProfile.id)) as { imported: number; names: string[] } | null;
    if (result) { setNotice({ kind: 'success', message: result.imported ? `Imported ${result.imported} mod file(s).` : 'No files imported.' }); await refreshMods(); }
  };
  const importPack = async (kind: 'resourcepacks' | 'shaderpacks') => {
    if (!currentProfile) return;
    const result = await run(() => window.prime.importResources(currentProfile.id, kind)) as { imported: number; names: string[] } | null;
    if (result) setNotice({ kind: 'success', message: result.imported ? `Imported ${result.imported} ${kind === 'resourcepacks' ? 'resource pack(s)' : 'shader pack(s)'}.` : 'No files imported.' });
  };
  const startSourceAnalyze = async () => {
    const report = await run(() => window.prime.analyzeModSource()) as SourceReport | null;
    if (report) { setSourceReport(report); setBuildReport(null); setNotice({ kind: 'success', message: `Inspected ${report.fileCount} file(s).` }); }
  };
  const startSourceBuild = async () => {
    setShowBuildConfirm(false);
    const report = await run(() => window.prime.buildModSource()) as BuildReport | null;
    if (report) { setBuildReport(report); setNotice({ kind: report.success ? 'success' : 'error', message: report.success ? `Build completed with ${report.jarFiles.length} JAR file(s).` : 'Build did not produce a confirmed JAR. See the output below.' }); }
  };

  const filteredVersions = useMemo(() => {
    const term = versionSearch.toLowerCase().trim();
    return versions.filter((version) => `${version.id} ${version.type}`.toLowerCase().includes(term)).slice(0, 250);
  }, [versions, versionSearch]);
  const taskPercent = (task: TaskProgress) => task.total && task.total > 0 && typeof task.current === 'number' ? Math.max(0, Math.min(100, Math.round(task.current * 100 / task.total))) : null;

  const sidebarGroups = [...new Set(navItems.map((item) => item.group))];
  return (
    <div className={`app-shell ${isArabic ? 'rtl' : ''} ${settings?.theme === 'light' ? 'light-theme' : ''}`} dir={isArabic ? 'rtl' : 'ltr'}>
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><img src="./assets/prime-logo.svg" alt="PRIME" /></div>
          <div><div className="brand-title">PRIME<span> CLIENT</span></div><div className="brand-subtitle">by djawad1</div></div>
        </div>
        <div className="sidebar-scroll">
          {sidebarGroups.map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-group-title">{isArabic ? ({ PLAY: 'اللعب', GAME: 'اللعبة', SYSTEM: 'النظام', PREFERENCES: 'التفضيلات' } as Record<string, string>)[group] : group}</div>
              {navItems.filter((item) => item.group === group).map((item) => (
                <button className={`nav-item ${page === item.id ? 'active' : ''}`} key={item.id} onClick={() => setPage(item.id)}>
                  <span className="nav-glyph">{item.glyph}</span><span>{isArabic ? arabicLabels[item.id] : labels[item.id]}</span>{page === item.id && <span className="nav-current" />}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="account-chip"><div className="avatar">{account?.name?.slice(0, 1).toUpperCase() ?? 'P'}</div><div className="account-chip-copy"><strong>{account?.name ?? t('Not signed in', 'لم يتم تسجيل الدخول')}</strong><small>{account ? t('Microsoft account', 'حساب Microsoft') : t('Offline library mode', 'وضع المكتبة المحلية')}</small></div><span className={`status-dot ${account ? 'on' : ''}`} /></div>
          <div className="footer-version">PRIME CLIENT <span>v1.0.0</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span className="breadcrumb-muted">PRIME</span><span className="breadcrumb-sep">/</span><strong>{isArabic ? arabicLabels[page] : labels[page]}</strong></div>
          <div className="topbar-actions">
            <div className="connection-indicator"><span className={`status-dot ${account ? 'on' : ''}`} />{account ? t('Account connected', 'الحساب متصل') : t('Local mode', 'وضع محلي')}</div>
            <button className="icon-button" title={t('Open settings', 'فتح الإعدادات')} onClick={() => setPage('settings')}>⚙</button>
            <div className="top-avatar">{account?.name?.slice(0, 1).toUpperCase() ?? 'P'}</div>
          </div>
        </header>

        <div className="page-content">
          {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === 'success' ? '✓' : notice.kind === 'error' ? '!' : 'i'}</span><div>{notice.message}</div><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
          {page === 'home' && <section className="home-page">
            <div className="welcome-line"><div><p className="eyebrow">YOUR WORLD. YOUR RULES.</p><h1>{t('Welcome back, player.', 'مرحبًا بعودتك أيها اللاعب.')}</h1><p className="page-subtitle">{t('Your Minecraft setup, ready when you are.', 'إعدادات ماينكرافت الخاصة بك جاهزة متى أردت.')}</p></div><div className="date-chip"><span className="date-pulse" /> {t('JAVA EDITION', 'إصدار Java')}</div></div>
            <div className="hero-card">
              <div className="hero-bg-grid" /><div className="hero-orb orb-one" /><div className="hero-orb orb-two" />
              <div className="hero-content"><div className="hero-kicker"><span className="live-mark" /> PRIME CLIENT <span className="kicker-divider">/</span> MINECRAFT JAVA</div>
                <h2>Build your<br /><span>next adventure.</span></h2>
                <p>{t('Choose an instance, tune your setup, and jump back into the world.', 'اختر ملف لعبتك واضبط الأداء ثم عد إلى عالمك.')}</p>
                <div className="hero-meta"><div><small>{t('ACTIVE PROFILE', 'الملف النشط')}</small><strong>{currentProfile?.name ?? '—'}</strong></div><div><small>{t('MINECRAFT VERSION', 'إصدار ماينكرافت')}</small><strong>{currentProfile?.versionId || t('Not selected', 'غير محدد')}</strong></div><div><small>{t('LOADER', 'محمّل التعديلات')}</small><strong>{currentProfile?.loader?.toUpperCase() ?? 'VANILLA'}</strong></div></div>
                <div className="hero-actions"><button className="primary-button play-button" disabled={busy || !currentProfile?.versionId || !installed.includes(currentProfile.versionId) || !account || gameStatus.running} onClick={() => void play()}><span className="play-triangle">▶</span>{gameStatus.running ? t('GAME RUNNING', 'اللعبة تعمل') : t('PLAY MINECRAFT', 'العب ماينكرافت')}<span className="button-arrow">↗</span></button><button className="ghost-button" onClick={() => setPage('versions')}>{t('Manage versions', 'إدارة الإصدارات')} <span>→</span></button></div>
                {!account && <div className="hero-hint">{t('Connect your official Microsoft account to launch Minecraft.', 'اربط حساب Microsoft الرسمي لتشغيل ماينكرافت.')} <button onClick={() => setPage('accounts')}>{t('Connect account', 'ربط الحساب')} ↗</button></div>}
                {currentProfile?.versionId && !installed.includes(currentProfile.versionId) && <div className="hero-hint">{t('This version is not installed in the selected profile.', 'هذا الإصدار غير مثبت في الملف المحدد.')} <button onClick={() => setPage('versions')}>{t('Install now', 'ثبّت الآن')} ↗</button></div>}
              </div><div className="hero-art" aria-hidden="true"><div className="planet-ring ring-a" /><div className="planet-ring ring-b" /><div className="planet"><div className="planet-top" /><div className="planet-pixel p1" /><div className="planet-pixel p2" /><div className="planet-pixel p3" /><div className="planet-pixel p4" /><div className="planet-pixel p5" /><div className="planet-pixel p6" /></div><div className="float-cube cube-a" /><div className="float-cube cube-b" /><div className="float-cube cube-c" /><div className="hero-art-glow" /></div>
            </div>
            <div className="section-heading"><div><p className="eyebrow">QUICK ACCESS</p><h3>{t('Your setup at a glance', 'ملخص إعداداتك')}</h3></div><button className="text-button" onClick={() => setPage('library')}>{t('View library', 'عرض المكتبة')} <span>→</span></button></div>
            <div className="stat-grid"><div className="stat-card"><div className="stat-icon mint">▤</div><div><small>{t('SAVED PROFILES', 'الملفات المحفوظة')}</small><strong>{profiles.length.toString().padStart(2, '0')}</strong><p>{t('Separate game folders', 'مجلدات مستقلة للعبة')}</p></div></div><div className="stat-card"><div className="stat-icon violet">◷</div><div><small>{t('INSTALLED VERSIONS', 'الإصدارات المثبتة')}</small><strong>{installed.length.toString().padStart(2, '0')}</strong><p>{t('In this profile', 'في هذا الملف')}</p></div></div><div className="stat-card"><div className="stat-icon blue">✣</div><div><small>{t('MOD FILES', 'ملفات التعديلات')}</small><strong>{mods.length.toString().padStart(2, '0')}</strong><p>{t('Local mod folder', 'مجلد التعديلات المحلي')}</p></div></div><div className="stat-card"><div className="stat-icon amber">{gameStatus.running ? '●' : '○'}</div><div><small>{t('GAME STATUS', 'حالة اللعبة')}</small><strong className="status-word">{gameStatus.running ? t('Running', 'تعمل') : t('Closed', 'مغلقة')}</strong><p>{gameStatus.pid ? `PID ${gameStatus.pid}` : t('Ready for launch', 'جاهزة للتشغيل')}</p></div></div></div>
            <div className="bottom-grid"><div className="panel recent-panel"><div className="panel-heading"><div><h3>{t('Recent activity', 'النشاط الأخير')}</h3><p>{t('Live status from this launcher session', 'حالة مباشرة من جلسة اللانشر')}</p></div><button className="small-outline" onClick={() => setPage('downloads')}>{t('View logs', 'عرض السجل')}</button></div>{progressList.length === 0 ? <div className="empty-state compact"><div className="empty-symbol">⌁</div><strong>{t('Nothing happening yet', 'لا يوجد نشاط بعد')}</strong><p>{t('Install a version or inspect a mod source to see task updates here.', 'ثبّت إصدارًا أو افحص مصدر مود لعرض تقدم المهام هنا.')}</p></div> : progressList.slice(0, 4).map((item) => <div className="activity-row" key={item.taskId}><span className={`activity-icon ${item.error ? 'bad' : item.done ? 'good' : ''}`}>{item.error ? '!' : item.done ? '✓' : '⋯'}</span><div className="activity-copy"><strong>{item.phase}</strong><span>{item.message}</span>{taskPercent(item) !== null && <div className="mini-progress"><i style={{ width: `${taskPercent(item)}%` }} /></div>}</div><small>{item.done ? t('Done', 'تم') : t('In progress', 'قيد التنفيذ')}</small></div>)}</div>
              <div className="panel tips-panel"><div className="tips-top"><div className="tip-star">✦</div><span className="eyebrow">PRIME TIP</span></div><h3>{t('Better performance starts with the right setup.', 'الأداء الأفضل يبدأ بالإعداد المناسب.')}</h3><p>{t('Pick a Java version that matches your Minecraft release. For older computers, keep render distance sensible and avoid heavy shaders.', 'اختر إصدار Java المطابق لماينكرافت. على الأجهزة القديمة، قلّل مسافة العرض وتجنّب الشيدرز الثقيلة.')}</p><button className="text-button" onClick={() => setPage('performance')}>{t('Tune performance', 'ضبط الأداء')} <span>→</span></button></div></div>
          </section>}

          {page === 'library' && <section><div className="page-title-row"><div><p className="eyebrow">YOUR INSTANCES</p><h1>{t('Library', 'المكتبة')}</h1><p className="page-subtitle">{t('Keep different Minecraft setups clean and independent.', 'نظّم إعدادات ماينكرافت في ملفات مستقلة.')}</p></div><span className="count-pill">{profiles.length} {t('profiles', 'ملفات')}</span></div>
            <div className="create-profile panel"><div className="create-profile-icon">＋</div><div className="create-profile-copy"><strong>{t('Create a new profile', 'إنشاء ملف جديد')}</strong><span>{t('A new profile gets its own game directory.', 'يحصل الملف الجديد على مجلد لعبة مستقل.')}</span></div><div className="inline-form"><input value={createName} maxLength={48} onChange={(e) => setCreateName(e.target.value)} placeholder={t('Profile name', 'اسم الملف')} onKeyDown={(e) => { if (e.key === 'Enter') void createProfile(); }} /><button className="primary-button" disabled={busy || !createName.trim()} onClick={() => void createProfile()}>{t('Create profile', 'إنشاء ملف')}</button></div></div>
            <div className="profile-grid">{profiles.map((profile) => <article className={`profile-card ${profile.id === currentProfile?.id ? 'selected' : ''}`} key={profile.id}><div className="profile-card-top"><div className="profile-cover"><div className="cover-grid" /><div className="cover-cube" /><span>PRIME</span></div><span className={`profile-badge ${profile.id === currentProfile?.id ? 'mint-badge' : ''}`}>{profile.id === currentProfile?.id ? t('ACTIVE', 'نشط') : t('PROFILE', 'ملف')}</span></div><div className="profile-card-body"><h3>{profile.name}</h3><p>{profile.versionId || t('No version selected', 'لم يتم اختيار إصدار')} <span>·</span> {profile.loader}</p><div className="profile-card-meta"><span>RAM</span><strong>{(profile.maxMemoryMb / 1024).toFixed(1)} GB</strong><span>·</span><span>{t('Created', 'أُنشئ')} {formatDate(profile.createdAt)}</span></div><div className="profile-card-path" title={profile.gameDir}>⌁ {profile.gameDir}</div><div className="profile-card-actions"><button className="primary-button small" onClick={() => void chooseProfile(profile.id)} disabled={profile.id === currentProfile?.id || busy}>{profile.id === currentProfile?.id ? t('Selected', 'محدد') : t('Select profile', 'اختيار الملف')}</button><button className="icon-button" title={t('Duplicate profile', 'نسخ الملف')} onClick={() => void run(async () => { await window.prime.duplicateProfile(profile.id); await refreshProfiles(); }, 'Profile duplicated.')}>▣</button><button className="icon-button" title={t('Open game folder', 'فتح مجلد اللعبة')} onClick={() => void run(() => window.prime.openFolder(profile.id, 'game'))}>↗</button><button className="icon-button danger-hover" title={t('Delete profile metadata only', 'حذف بيانات الملف فقط')} disabled={profiles.length <= 1} onClick={() => { if (window.confirm(t('Delete this profile entry? Its game files will stay on disk.', 'حذف بيانات هذا الملف؟ ستبقى ملفات اللعبة على القرص.'))) void run(async () => { await window.prime.deleteProfile(profile.id); await refreshProfiles(); }, 'Profile removed. Game files were preserved.'); }}>×</button></div></div></article>)}</div>
          </section>}

          {page === 'versions' && <section><div className="page-title-row"><div><p className="eyebrow">MOJANG VERSION MANIFEST</p><h1>{t('Versions', 'الإصدارات')}</h1><p className="page-subtitle">{t('Browse official releases and install them into the selected profile.', 'تصفح إصدارات Mojang الرسمية وثبّتها في الملف المحدد.')}</p></div><button className="small-outline" onClick={() => void refreshVersions(true)} disabled={searchingVersions}>{searchingVersions ? '◌ ' : '↻ '}{t('Refresh catalog', 'تحديث القائمة')}</button></div>
            <div className="version-layout"><div className="panel version-browser"><div className="panel-heading"><div><h3>{t('Official catalog', 'القائمة الرسمية')}</h3><p>{versionsCached ? t('Cached manifest · offline browsing', 'بيانات مخزنة · تصفح دون اتصال') : t('Official Mojang metadata', 'بيانات Mojang الرسمية')}</p></div><span className="count-pill">{versions.length}</span></div><div className="search-field"><span>⌕</span><input value={versionSearch} onChange={(e) => setVersionSearch(e.target.value)} placeholder={t('Search version ID…', 'ابحث عن رقم الإصدار…')} /></div>{versionsError && <div className="inline-warning">{versionsError}</div>}<div className="version-list">{filteredVersions.map((version) => <button className={`version-row ${selectedVersion === version.id ? 'chosen' : ''}`} key={version.id} onClick={() => setSelectedVersion(version.id)}><span className={`version-type type-${version.type}`}>{version.type === 'release' ? 'R' : version.type === 'snapshot' ? 'S' : 'B'}</span><span className="version-row-copy"><strong>{version.id}</strong><small>{formatDate(version.releaseTime)}</small></span><span className="version-kind">{version.type}</span>{installed.includes(version.id) && <span className="installed-tick">✓</span>}</button>)}{filteredVersions.length === 0 && <div className="empty-state"><strong>{t('No versions found', 'لم يتم العثور على إصدارات')}</strong><p>{t('Check your search or refresh the manifest while online.', 'تحقق من البحث أو حدّث القائمة أثناء الاتصال.')}</p></div>}</div></div>
              <div className="version-side"><div className="panel install-panel"><div className="install-icon">◷</div><p className="eyebrow">{t('SELECTED RELEASE', 'الإصدار المحدد')}</p><h2>{selectedVersion || '—'}</h2><p>{t('Profile', 'الملف')}: <strong>{currentProfile?.name ?? '—'}</strong></p><p>{t('Type', 'النوع')}: <strong>{versions.find((v) => v.id === selectedVersion)?.type ?? '—'}</strong></p><p>{t('Status', 'الحالة')}: <strong className={installed.includes(selectedVersion) ? 'text-mint' : ''}>{installed.includes(selectedVersion) ? t('Installed', 'مثبت') : t('Not installed', 'غير مثبت')}</strong></p><button className="primary-button full-button" disabled={busy || !currentProfile || !selectedVersion || installed.includes(selectedVersion)} onClick={() => void runInstall()}>{busy ? t('WORKING…', 'جارٍ العمل…') : installed.includes(selectedVersion) ? t('INSTALLED', 'مثبت') : t('INSTALL VERSION', 'تثبيت الإصدار')} <span>↓</span></button>{currentProfile && <button className="ghost-button full-button" onClick={() => void updateCurrentProfile({ versionId: selectedVersion })} disabled={!selectedVersion || busy}>{t('Set as profile version', 'تعيينه لإصدار الملف')}</button>}<div className="info-note"><span>i</span><p>{t('Vanilla installation is supported in this build. Fabric, Forge, and NeoForge installers are not implemented yet.', 'التثبيت Vanilla مدعوم في هذه النسخة. مثبتات Fabric وForge وNeoForge لم تُنفذ بعد.')}</p></div></div><div className="panel installed-panel"><div className="panel-heading"><div><h3>{t('Installed here', 'المثبت في هذا الملف')}</h3><p>{currentProfile?.name ?? '—'}</p></div><span className="count-pill">{installed.length}</span></div>{installed.length === 0 ? <div className="empty-state compact"><div className="empty-symbol">↓</div><strong>{t('No complete installations', 'لا توجد تثبيتات مكتملة')}</strong><p>{t('Installed versions appear here after verification.', 'ستظهر الإصدارات بعد التحقق من ملفاتها.')}</p></div> : installed.map((v) => <div className="installed-row" key={v}><span className="installed-dot" /><strong>{v}</strong><button className="text-button" onClick={() => { setSelectedVersion(v); if (currentProfile) void updateCurrentProfile({ versionId: v }); }}>{t('Use', 'استخدم')} →</button></div>)}</div></div>
            </div>
          </section>}

          {page === 'mods' && <section><div className="page-title-row"><div><p className="eyebrow">PROFILE CONTENT</p><h1>{t('Mod manager', 'مدير التعديلات')}</h1><p className="page-subtitle">{t('Import and enable local mod JARs for a compatible profile.', 'استورد ملفات JAR محلية وفعّلها في ملف متوافق.')}</p></div><button className="primary-button" onClick={() => void importModFiles()} disabled={!currentProfile || busy}>＋ {t('Import mods', 'استيراد تعديلات')}</button></div>
            <div className="inline-warning high-warning"><strong>{t('Safety note', 'تنبيه أمان')}</strong> — {t('Mod JAR files execute code inside Minecraft. Only import files from sources you trust, and use the correct loader/version.', 'ملفات المود تنفذ كودًا داخل اللعبة. لا تستورد إلا الملفات الموثوقة وتأكد من توافق المحمّل والإصدار.')}</div>
            <div className="panel mods-panel"><div className="panel-heading"><div><h3>{t('Mods in this profile', 'تعديلات هذا الملف')}</h3><p>{currentProfile?.gameDir}/mods</p></div><span className="count-pill">{mods.length} {t('files', 'ملفات')}</span></div>{mods.length === 0 ? <div className="empty-state"><div className="empty-symbol">✣</div><strong>{t('Your mods folder is empty', 'مجلد التعديلات فارغ')}</strong><p>{t('Import a JAR or open the mods folder and copy your file there.', 'استورد ملف JAR أو افتح المجلد وانسخ الملف إليه.')}</p><button className="small-outline" onClick={() => currentProfile && void run(() => window.prime.openFolder(currentProfile.id, 'mods'))}>{t('Open mods folder', 'فتح مجلد التعديلات')}</button></div> : <div className="table-wrap"><table><thead><tr><th>{t('FILE', 'الملف')}</th><th>{t('SIZE', 'الحجم')}</th><th>{t('STATE', 'الحالة')}</th><th>{t('ACTION', 'الإجراء')}</th></tr></thead><tbody>{mods.map((mod) => <tr key={mod.name}><td><div className="file-cell"><div className="file-icon">JAR</div><div><strong>{mod.name}</strong><small>{t('Local mod file', 'ملف مود محلي')}</small></div></div></td><td>{formatBytes(mod.size)}</td><td><span className={`state-tag ${mod.enabled ? 'enabled' : 'disabled'}`}>{mod.enabled ? t('Enabled', 'مفعّل') : t('Disabled', 'معطّل')}</span></td><td><button className="small-outline" onClick={() => void run(async () => { await window.prime.toggleMod(currentProfile!.id, mod.name, !mod.enabled); await refreshMods(); }, mod.enabled ? 'Mod disabled.' : 'Mod enabled.')}>{mod.enabled ? t('Disable', 'تعطيل') : t('Enable', 'تفعيل')}</button></td></tr>)}</tbody></table></div>}</div>
            <div className="resource-grid"><div className="panel resource-card"><div className="resource-symbol purple">▧</div><div><h3>{t('Resource packs', 'حزم الموارد')}</h3><p>{t('Import ZIP packs into this profile.', 'استورد حزم ZIP لهذا الملف.')}</p></div><button className="small-outline" onClick={() => currentProfile && void importPack('resourcepacks')}>{t('Import ZIP', 'استيراد ZIP')}</button><button className="text-button" onClick={() => currentProfile && void run(() => window.prime.openFolder(currentProfile.id, 'resourcepacks'))}>{t('Open folder', 'فتح المجلد')} ↗</button></div><div className="panel resource-card"><div className="resource-symbol blue">◈</div><div><h3>{t('Shader packs', 'حزم الشيدرز')}</h3><p>{t('Shaders may lower FPS and require compatible mods/GPU.', 'قد تخفض الشيدرز FPS وتتطلب دعمًا مناسبًا.')}</p></div><button className="small-outline" onClick={() => currentProfile && void importPack('shaderpacks')}>{t('Import ZIP', 'استيراد ZIP')}</button><button className="text-button" onClick={() => currentProfile && void run(() => window.prime.openFolder(currentProfile.id, 'shaderpacks'))}>{t('Open folder', 'فتح المجلد')} ↗</button></div></div>
          </section>}

          {page === 'performance' && <section><div className="page-title-row"><div><p className="eyebrow">TUNE YOUR EXPERIENCE</p><h1>{t('Performance', 'الأداء')}</h1><p className="page-subtitle">{t('Choose reasonable runtime settings per profile. Results depend on your hardware and mods.', 'اضبط إعدادات تشغيل معقولة لكل ملف. النتائج تعتمد على الجهاز والتعديلات.')}</p></div><span className="info-pill">⌁ {t('Profile-specific', 'خاص بالملف')}</span></div>
            {!currentProfile ? <div className="panel empty-state">Create a profile first.</div> : <div className="performance-layout"><div className="panel settings-panel"><div className="panel-heading"><div><h3>{t('Memory allocation', 'تخصيص الذاكرة')}</h3><p>{t('Applied when the game launches', 'تُطبق عند تشغيل اللعبة')}</p></div><div className="stat-icon mint">▥</div></div><div className="field-grid"><label className="form-field"><span>{t('Minimum memory (MB)', 'الحد الأدنى للذاكرة (MB)')}</span><input type="number" min={512} max={65536} step={512} value={currentProfile.minMemoryMb} onChange={(e) => setProfiles((old) => old.map((p) => p.id === currentProfile.id ? { ...p, minMemoryMb: Number(e.target.value) } : p))} onBlur={(e) => void updateCurrentProfile({ minMemoryMb: Number(e.target.value) })} /></label><label className="form-field"><span>{t('Maximum memory (MB)', 'الحد الأعلى للذاكرة (MB)')}</span><input type="number" min={512} max={65536} step={512} value={currentProfile.maxMemoryMb} onChange={(e) => setProfiles((old) => old.map((p) => p.id === currentProfile.id ? { ...p, maxMemoryMb: Number(e.target.value) } : p))} onBlur={(e) => void updateCurrentProfile({ maxMemoryMb: Number(e.target.value) })} /></label></div><div className="memory-visual"><div className="memory-visual-top"><span>{t('Configured maximum', 'الحد الأعلى')}</span><strong>{(currentProfile.maxMemoryMb / 1024).toFixed(1)} GB</strong></div><div className="memory-bar"><i style={{ width: `${Math.min(100, currentProfile.maxMemoryMb / 65536 * 100)}%` }} /></div><small>{t('The system’s total/available memory is not measured by this screen. Avoid allocating almost all RAM to Minecraft.', 'لا تقيس هذه الشاشة الذاكرة الكلية أو المتاحة في النظام. لا تخصص معظم RAM لماينكرافت.')}</small></div><div className="panel-actions"><button className="primary-button" onClick={() => void updateCurrentProfile({ minMemoryMb: currentProfile.minMemoryMb, maxMemoryMb: currentProfile.maxMemoryMb })}>{t('Save memory settings', 'حفظ إعدادات الذاكرة')}</button><button className="ghost-button" onClick={() => void updateCurrentProfile({ minMemoryMb: 1024, maxMemoryMb: 4096 })}>{t('Reset to defaults', 'استعادة الافتراضي')}</button></div></div>
                <div className="panel settings-panel"><div className="panel-heading"><div><h3>{t('Java runtime', 'بيئة Java')}</h3><p>{t('Select the runtime used by this profile', 'اختر بيئة Java لهذا الملف')}</p></div><div className="stat-icon blue">J</div></div><div className="runtime-current"><small>{t('CURRENT JAVA PATH', 'مسار JAVA الحالي')}</small><code>{currentProfile.javaPath || javaList[0]?.path || t('Auto-detect from PATH', 'اكتشاف تلقائي من PATH')}</code></div>{javaList.length ? <div className="java-detection-list">{javaList.slice(0, 4).map((java) => <div key={java.path}><div><strong>Java {java.major}</strong><small>{java.path}</small></div><span className="state-tag enabled">{t('Detected', 'مكتشف')}</span></div>)}</div> : <div className="inline-warning">{t('No Java executable detected in PATH. Select one manually.', 'لم يتم اكتشاف Java في PATH. اختر الملف التنفيذي يدويًا.')}</div>}<div className="panel-actions"><button className="primary-button" onClick={() => void chooseJava()}>{t('Choose Java executable', 'اختيار Java')} ↗</button><button className="ghost-button" onClick={() => void run(async () => { const detected = await window.prime.detectJava(); setJavaList(detected); }, 'Java scan complete.')}>{t('Rescan', 'إعادة الفحص')}</button></div></div>
                <div className="performance-warning"><span>!</span><div><strong>{t('No fake FPS promises', 'لا توجد وعود وهمية بزيادة FPS')}</strong><p>{t('PRIME CLIENT does not claim a fixed FPS boost or real DLSS support. Actual improvements require compatible optimizations and tests on your machine.', 'لا يدّعي PRIME CLIENT زيادة ثابتة في FPS أو دعم DLSS حقيقي. التحسينات تعتمد على تعديلات متوافقة واختبارات فعلية.')}</p></div></div></div>}
          </section>}

          {page === 'downloads' && <section><div className="page-title-row"><div><p className="eyebrow">TASK CENTER</p><h1>{t('Downloads & activity', 'التنزيلات والنشاط')}</h1><p className="page-subtitle">{t('Live task progress and local build/install logs.', 'تقدم المهام والسجلات المحلية للتثبيت والبناء.')}</p></div><button className="small-outline" onClick={() => setProgressList([])}>{t('Clear activity view', 'مسح عرض النشاط')}</button></div><div className="panel downloads-panel"><div className="panel-heading"><div><h3>{t('Task history', 'سجل المهام')}</h3><p>{t('Tasks are kept only for this launcher session.', 'يُحفظ سجل المهام لهذه الجلسة فقط.')}</p></div><span className="count-pill">{progressList.length}</span></div>{progressList.length === 0 ? <div className="empty-state"><div className="empty-symbol">↓</div><strong>{t('No active or recent tasks', 'لا توجد مهام نشطة أو حديثة')}</strong><p>{t('Version downloads and source builds will appear here.', 'ستظهر هنا تنزيلات الإصدارات وعمليات بناء المصدر.')}</p></div> : progressList.map((item) => <div className="task-row" key={item.taskId}><div className={`task-status ${item.error ? 'failed' : item.done ? 'finished' : ''}`}>{item.error ? '!' : item.done ? '✓' : '…'}</div><div className="task-main"><div className="task-title-row"><strong>{item.phase.toUpperCase()}</strong><small>{item.done ? t('Complete', 'مكتمل') : t('Running', 'جارٍ')}</small></div><p>{item.message}</p>{taskPercent(item) !== null && <div className="progress-track"><i style={{ width: `${taskPercent(item)}%` }} /></div>}{item.error && <pre className="error-output">{item.error}</pre>}</div></div>)}</div><div className="panel log-shortcuts"><div><div className="resource-symbol blue">≡</div><div><h3>{t('Minecraft launch log', 'سجل تشغيل ماينكرافت')}</h3><p>{t('Open the most recent PRIME CLIENT Java process log for this profile.', 'افتح أحدث سجل لعملية Java لهذا الملف.')}</p></div></div><button className="small-outline" disabled={!currentProfile} onClick={() => currentProfile && void run(() => window.prime.openGameLog(currentProfile.id))}>{t('Open launch log', 'فتح سجل التشغيل')} ↗</button></div></section>}

          {page === 'settings' && <section><div className="page-title-row"><div><p className="eyebrow">PREFERENCES</p><h1>{t('Settings', 'الإعدادات')}</h1><p className="page-subtitle">{t('Customize the launcher experience.', 'خصص تجربة استخدام اللانشر.')}</p></div></div><div className="settings-layout"><div className="panel settings-panel"><div className="panel-heading"><div><h3>{t('Appearance & language', 'المظهر واللغة')}</h3><p>{t('Changes apply immediately.', 'تُطبق التغييرات فورًا.')}</p></div></div><label className="form-field"><span>{t('Language / اللغة', 'اللغة / Language')}</span><select value={settings?.locale ?? 'en'} onChange={(e) => void updateSettings({ locale: e.target.value as 'en' | 'ar' }, 'Language preference saved.')}><option value="en">English</option><option value="ar">العربية</option></select></label><label className="form-field"><span>{t('Theme', 'المظهر')}</span><select value={settings?.theme ?? 'dark'} onChange={(e) => void updateSettings({ theme: e.target.value as 'dark' | 'light' }, 'Theme preference saved.')}><option value="dark">{t('Dark', 'داكن')}</option><option value="light">{t('Light (experimental)', 'فاتح (تجريبي)')}</option></select></label><div className="form-divider" /><div className="form-field"><span>{t('Game storage folder', 'مجلد تخزين اللعبة')}</span><div className="path-picker"><code title={settings?.gameRoot}>{settings?.gameRoot ?? '—'}</code><button className="small-outline" onClick={() => void run(async () => { const root = await window.prime.chooseGameRoot(); if (root) { await refreshProfiles(); } return root; }, 'Game storage folder updated for new profiles.')}>{t('Choose folder', 'اختيار مجلد')} ↗</button></div><small className="field-help">{t('Changing the root affects new profiles; existing profile directories are preserved.', 'تغيير المسار يؤثر على الملفات الجديدة، وتبقى المجلدات الموجودة كما هي.')}</small></div><div className="form-field"><span>{t('Download concurrency', 'عدد التنزيلات المتزامنة')}</span><select value={settings?.downloadConcurrency ?? 6} onChange={(e) => void updateSettings({ downloadConcurrency: Number(e.target.value) }, 'Download setting saved.')}><option value="2">2 — Low bandwidth</option><option value="4">4 — Balanced</option><option value="6">6 — Recommended</option><option value="8">8 — Fast connection</option><option value="12">12 — Advanced</option></select></div></div>
              <div className="panel settings-panel"><div className="panel-heading"><div><h3>{t('Storage & diagnostics', 'التخزين والتشخيص')}</h3><p>{t('Local paths and safe defaults.', 'المسارات المحلية والإعدادات الآمنة.')}</p></div><div className="stat-icon mint">⌁</div></div><div className="diagnostic-row"><span>{t('Selected profile', 'الملف المحدد')}</span><strong>{currentProfile?.name ?? '—'}</strong></div><div className="diagnostic-row"><span>{t('Installed game versions', 'إصدارات اللعبة المثبتة')}</span><strong>{installed.length}</strong></div><div className="diagnostic-row"><span>{t('Java runtimes detected', 'بيئات Java المكتشفة')}</span><strong>{javaList.length}</strong></div><div className="diagnostic-row"><span>{t('Secure token storage', 'تخزين الرموز الآمن')}</span><strong>{t('OS-backed encryption required', 'يتطلب تشفير النظام')}</strong></div><div className="inline-warning">{t('Settings and profile metadata are local. No telemetry or automatic log uploads are enabled.', 'الإعدادات وبيانات الملفات محلية. لا يوجد تتبع أو رفع تلقائي للسجلات.')}</div><button className="ghost-button" onClick={() => void run(async () => { const [newSettings] = await Promise.all([window.prime.getSettings(), refreshProfiles()]); setSettings(newSettings); }, 'Local configuration reloaded.')}>{t('Reload local configuration', 'إعادة تحميل الإعدادات المحلية')}</button></div></div></section>}

          {page === 'accounts' && <section><div className="page-title-row"><div><p className="eyebrow">OFFICIAL SIGN-IN</p><h1>{t('Accounts', 'الحسابات')}</h1><p className="page-subtitle">{t('Use the official Microsoft/Xbox/Minecraft sign-in flow.', 'استخدم تسجيل الدخول الرسمي عبر Microsoft وXbox وMinecraft.')}</p></div><span className={`state-tag ${account ? 'enabled' : 'disabled'}`}>{account ? t('Connected', 'متصل') : t('Not connected', 'غير متصل')}</span></div><div className="account-layout"><div className="panel account-main-card"><div className="account-hero-icon">{account?.name?.slice(0, 1).toUpperCase() ?? 'M'}</div><p className="eyebrow">MICROSOFT ACCOUNT</p><h2>{account?.name ?? t('Connect your account', 'اربط حسابك')}</h2><p className="page-subtitle">{account ? t('The account is connected to Minecraft Services.', 'الحساب متصل بخدمات Minecraft.') : t('PRIME CLIENT does not request your Microsoft password in its own interface.', 'لا يطلب PRIME CLIENT كلمة مرور Microsoft داخل واجهته.')}</p>{account && <div className="account-details"><div><small>{t('MINECRAFT UUID', 'معرّف اللاعب')}</small><code>{account.uuid}</code></div><div><small>{t('SESSION', 'الجلسة')}</small><strong>{account.expiresAt > Date.now() ? t('Token stored securely', 'تم حفظ الرمز بأمان') : t('Refresh needed on next launch', 'تحتاج الجلسة للتحديث عند التشغيل')}</strong></div></div>}{!account ? <button className="primary-button connect-button" disabled={busy} onClick={() => void run(async () => { const saved = await window.prime.signInMicrosoft(); setAccount(saved); return saved; }, 'Microsoft account connected and entitlement verified.')}>{t('Sign in with Microsoft', 'تسجيل الدخول عبر Microsoft')} <span>↗</span></button> : <button className="ghost-button" onClick={() => void run(async () => { await window.prime.signOut(); setAccount(null); }, 'Account signed out.')}>{t('Sign out', 'تسجيل الخروج')}</button>}<div className="info-note"><span>i</span><p>{t('A valid Minecraft: Java Edition entitlement and profile are checked before launch. Local/offline profile names do not bypass official multiplayer authentication.', 'يتم التحقق من امتلاك Minecraft Java Edition ووجود ملف لاعب قبل التشغيل. أسماء الملفات المحلية لا تتجاوز مصادقة اللعب الجماعي الرسمية.')}</p></div></div>
              <div className="panel settings-panel"><div className="panel-heading"><div><h3>{t('Application registration', 'تسجيل التطبيق')}</h3><p>{t('Developer setup required once per installation.', 'يتطلب إعداد المطور مرة واحدة.')}</p></div></div><label className="form-field"><span>{t('Microsoft application Client ID', 'معرّف تطبيق Microsoft')}</span><input value={settings?.microsoftClientId ?? ''} onChange={(e) => setSettings((old) => old ? { ...old, microsoftClientId: e.target.value } : old)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" /></label><div className="field-help">{t('Use a public desktop app registration that supports personal Microsoft accounts. A client secret must not be used in this desktop client.', 'استخدم تسجيل تطبيق سطح مكتب عامًا يدعم حسابات Microsoft الشخصية. لا تضع client secret داخل التطبيق.')}</div><button className="primary-button" onClick={() => void updateSettings({ microsoftClientId: settings?.microsoftClientId ?? '' }, 'Microsoft Client ID saved locally.')}>{t('Save Client ID', 'حفظ معرّف التطبيق')}</button><div className="form-divider" /><div className="checklist"><div><span>1</span><p>{t('Register a public desktop app in Microsoft Entra.', 'سجّل تطبيق سطح مكتب عامًا في Microsoft Entra.')}</p></div><div><span>2</span><p>{t('Configure personal accounts and compatible loopback redirect behavior.', 'اضبط الحسابات الشخصية وعنوان إعادة التوجيه المحلي.')}</p></div><div><span>3</span><p>{t('Sign in and verify the Java Edition entitlement.', 'سجّل الدخول وتحقق من امتلاك Java Edition.')}</p></div></div></div></div></section>}

          {page === 'source' && <section><div className="page-title-row"><div><p className="eyebrow">SOURCE-TO-BUILD WORKFLOW</p><h1>{t('Mod source inspector', 'فاحص مصدر المود')}</h1><p className="page-subtitle">{t('Inspect the real project before attempting a Gradle build.', 'افحص المشروع الحقيقي قبل محاولة بنائه عبر Gradle.')}</p></div><span className="info-pill">.java · .kt · Gradle</span></div><div className="inline-warning high-warning"><strong>{t('No source file was bundled.', 'لم يتم إرفاق مصدر مود.')}</strong> {t('Select a source file or project folder to inspect it. Source code is never assumed to be a valid JAR.', 'اختر مجلد المشروع لفحصه. لا يُفترض أن المصدر ملف JAR صالح.')}</div><div className="source-action-grid"><div className="panel source-action-card"><div className="source-action-icon">⌕</div><h3>{t('Inspect source project', 'فحص مصدر المشروع')}</h3><p>{t('Scan code files, metadata, Gradle setup, loader hints, and version hints.', 'افحص ملفات الكود والبيانات وGradle ومؤشرات المحمّل والإصدار.')}</p><button className="primary-button" disabled={busy} onClick={() => void startSourceAnalyze()}>{t('Choose file or folder', 'اختيار مجلد وفحص')} ↗</button></div><div className="panel source-action-card"><div className="source-action-icon build">⌘</div><h3>{t('Build actual JAR', 'بناء JAR فعلي')}</h3><p>{t('Run the project’s own Gradle Wrapper and collect real build/libs JARs after success.', 'شغّل Gradle Wrapper الخاص بالمشروع واجمع ملفات JAR الحقيقية بعد النجاح.')}</p><button className="primary-button" disabled={busy} onClick={() => setShowBuildConfirm(true)}>{t('Choose project & build', 'اختيار المشروع وبناؤه')} ▶</button></div></div>
            {sourceReport && <div className="panel source-report"><div className="panel-heading"><div><h3>{t('Inspection report', 'تقرير الفحص')}</h3><p>{sourceReport.path}</p></div><span className="count-pill">{sourceReport.selectionType === 'file' ? t('Single file', 'ملف منفرد') : t('Project folder', 'مجلد مشروع')} · {sourceReport.fileCount} {t('files', 'ملف')}</span></div><div className="source-metrics"><div><small>JAVA</small><strong>{sourceReport.javaCount}</strong></div><div><small>KOTLIN</small><strong>{sourceReport.kotlinCount}</strong></div><div><small>GRADLE</small><strong>{sourceReport.hasGradle ? 'Found' : 'Missing'}</strong></div><div><small>WRAPPER</small><strong>{sourceReport.wrapperPath ? 'Found' : 'Missing'}</strong></div></div><div className="report-detail-grid"><div><h4>{t('Loader hints', 'مؤشرات المحمّل')}</h4><p>{sourceReport.candidateLoaders.length ? sourceReport.candidateLoaders.join(', ') : t('Unknown', 'غير معروف')}</p><h4>{t('Minecraft version hints', 'مؤشرات إصدار ماينكرافت')}</h4><p>{sourceReport.candidateMinecraftVersions.length ? sourceReport.candidateMinecraftVersions.join(', ') : t('Not detected', 'لم يتم اكتشافه')}</p></div><div><h4>{t('Metadata files', 'ملفات البيانات')}</h4>{sourceReport.metadataFiles.length ? <ul>{sourceReport.metadataFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul> : <p>{t('None detected.', 'لم يتم العثور على ملفات.')}</p>}<h4>{t('Warnings', 'تحذيرات')}</h4>{sourceReport.warnings.length ? <ul className="warning-list">{sourceReport.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p className="text-mint">{t('No structural warnings detected.', 'لم تُكتشف تحذيرات بنيوية.')}</p>}</div></div></div>}
            {buildReport && <div className="panel source-report"><div className="panel-heading"><div><h3>{t('Gradle build result', 'نتيجة بناء Gradle')}</h3><p>{buildReport.projectPath}</p></div><span className={`state-tag ${buildReport.success ? 'enabled' : 'disabled'}`}>{buildReport.success ? t('Success', 'نجاح') : t('Failed / no JAR', 'فشل / لا يوجد JAR')}</span></div>{buildReport.jarFiles.length > 0 ? <div className="jar-results">{buildReport.jarFiles.map((file) => <div key={file}><span className="file-icon">JAR</span><code>{file}</code><span className="text-mint">✓ {t('Verified ZIP structure', 'بنية ZIP صالحة')}</span></div>)}</div> : <div className="inline-warning">{t('No valid JAR was confirmed. The output below is the real build log.', 'لم يتم تأكيد أي JAR صالح. السجل أدناه هو مخرجات البناء الحقيقية.')}</div>}<pre className="build-output">{buildReport.output || t('No output was returned by Gradle.', 'لم يُرجع Gradle مخرجات.')}</pre></div>}
            {showBuildConfirm && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true"><div className="confirm-symbol">!</div><h3>{t('Run an external Gradle build?', 'تشغيل بناء Gradle خارجي؟')}</h3><p>{t('Gradle build scripts execute code on your computer. Only select a source project you trust. PRIME CLIENT will not fabricate a JAR if the build fails.', 'تُنفذ ملفات Gradle كودًا على جهازك. اختر مشروعًا موثوقًا فقط. لن ينشئ PRIME CLIENT ملف JAR وهميًا عند فشل البناء.')}</p><div className="modal-actions"><button className="ghost-button" onClick={() => setShowBuildConfirm(false)}>{t('Cancel', 'إلغاء')}</button><button className="primary-button" onClick={() => void startSourceBuild()}>{t('I trust this project — continue', 'أثق بهذا المشروع — متابعة')}</button></div></div></div>}
          </section>}

          <footer className="page-footer"><span>PRIME CLIENT <i /> by djawad1</span><span>{t('Built for Minecraft Java Edition', 'صُنع من أجل Minecraft Java Edition')}</span></footer>
        </div>
      </main>
    </div>
  );
}
