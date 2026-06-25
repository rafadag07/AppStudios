import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlarmClock,
  Atom,
  Bold,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Clock3,
  HelpCircle,
  FileText,
  Grid3X3,
  Heading1,
  Heading2,
  Image,
  Italic,
  Languages,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  Minimize2,
  Network,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Quote,
  RotateCcw,
  Save,
  Search,
  Sigma,
  Sparkles,
  Square,
  Target,
  Trash2,
  Underline,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { STORAGE_KEY, createId, initialData } from "./data/schema";
import { getStoredFile, saveStoredFile } from "./data/fileStore";
import {
  createSyncCode,
  fetchCloudData,
  fetchSharedSpace,
  getCurrentSession,
  isSupabaseConfigured,
  normalizeSyncCode,
  saveCloudData,
  saveSharedSpace,
  signInWithEmail,
  signOutCloud,
  subscribeToCloudData,
  subscribeToSharedSpace,
  supabase,
} from "./data/supabaseClient";

const days = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const statuses = ["nada", "medio", "estudiado"];
const priorities = ["baja", "media", "alta"];
const resourceTypes = ["link", "pdf", "video", "libro", "otro"];
const SYNC_CODE_KEY = "summer-study-campus-sync-code";
const POMODORO_HISTORY_KEY = "appstudios-pomodoro-history-v1";
const subjectSections = [
  { id: "teoria", label: "Teoría" },
  { id: "seminarios", label: "Seminarios" },
  { id: "practicas", label: "Prácticas" },
  { id: "preguntas", label: "Preguntas" },
];

const defaultStudySections = subjectSections.filter((section) => section.id !== "preguntas");
const questionsSection = subjectSections.find((section) => section.id === "preguntas");

function getSubjectStudySections(subject) {
  const sections = subject?.studySections?.length ? subject.studySections : defaultStudySections;
  return sections.map((section) => ({ ...section }));
}

function getAllSubjectSections(subject) {
  return [...getSubjectStudySections(subject), { ...questionsSection, label: subject?.questionsLabel || questionsSection.label }];
}

const iconMap = {
  network: Network,
  languages: Languages,
  sigma: Sigma,
  grid: Grid3X3,
  atom: Atom,
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function readStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : initialData;
    migrateSubjectQuestions(parsed);
    if (!parsed.__eventsClearedV2) {
      parsed.events = [];
      parsed.__eventsClearedV2 = true;
    }
    return parsed;
  } catch {
    const fallback = { ...initialData, events: [], __eventsClearedV2: true };
    migrateSubjectQuestions(fallback);
    return fallback;
  }
}

function migrateSubjectQuestions(data) {
  data.subjects?.forEach((subject) => {
    if (!subject.qa) subject.qa = [];
    const existing = new Set(subject.qa.map((item) => item.id));
    subject.themes?.forEach((theme) => {
      (theme.qa || []).forEach((item) => {
        if (!existing.has(item.id)) {
          subject.qa.push({ ...item, sourceThemeId: theme.id, sourceThemeName: theme.name });
          existing.add(item.id);
        }
      });
      delete theme.qa;
    });
  });
}

function useGlobalPomodoro(data) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(data.subjects[0]?.id || "");
  const [mode, setMode] = useState("study");
  const [durations, setDurations] = useState({ study: 25, short: 5, long: 15 });
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [notes, setNotes] = useState("");
  const [completionPrompt, setCompletionPrompt] = useState(null);
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(POMODORO_HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const selectedSubject = data.subjects.find((subject) => subject.id === selectedSubjectId) || data.subjects[0];
  const modeLabels = { study: "Estudio", short: "Descanso corto", long: "Descanso largo" };

  useEffect(() => {
    if (!selectedSubjectId && data.subjects[0]) setSelectedSubjectId(data.subjects[0].id);
  }, [data.subjects, selectedSubjectId]);

  useEffect(() => {
    localStorage.setItem(POMODORO_HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const notifyPomodoro = (title, body) => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  };

  const requestNotificationPermission = () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  };

  const saveSession = (fullDuration = false) => {
    const duration = fullDuration ? durations[mode] : Math.max(1, durations[mode] - Math.ceil(seconds / 60));
    const session = {
      id: createId("pomodoro"),
      mode,
      modeLabel: modeLabels[mode],
      subjectId: selectedSubject?.id || null,
      subjectName: selectedSubject?.name || "Sin asignatura",
      duration,
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    };
    setHistory((current) => [session, ...current].slice(0, 150));
  };

  const start = () => {
    requestNotificationPermission();
    setCompletionPrompt(null);
    setRunning(true);
  };

  const pause = () => setRunning(false);

  const reset = () => {
    setRunning(false);
    setSeconds(durations[mode] * 60);
  };

  const finish = () => {
    setRunning(false);
    if (seconds > 0 && seconds < durations[mode] * 60) saveSession(false);
    setSeconds(durations[mode] * 60);
    setCompletionPrompt(null);
  };

  const changeMode = (nextMode, autoStart = false) => {
    setMode(nextMode);
    setSeconds(durations[nextMode] * 60);
    setRunning(autoStart);
    setCompletionPrompt(null);
  };

  const startBreak = (breakMode) => changeMode(breakMode, true);

  const updateDuration = (key, delta) => {
    setDurations((current) => {
      const nextValue = Math.max(1, Math.min(90, current[key] + delta));
      const next = { ...current, [key]: nextValue };
      if (key === mode) setSeconds(nextValue * 60);
      return next;
    });
    setRunning(false);
  };

  const resetDurations = () => {
    setDurations({ study: 25, short: 5, long: 15 });
    setMode("study");
    setSeconds(25 * 60);
    setRunning(false);
    setCompletionPrompt(null);
  };

  const deleteSession = (sessionId) => setHistory((current) => current.filter((session) => session.id !== sessionId));

  const clearHistory = () => {
    if (!window.confirm("Borrar todo el historial de pomodoros?")) return;
    setHistory([]);
  };

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value > 1) return value - 1;
        window.clearInterval(timer);
        setRunning(false);
        if (mode === "study") {
          saveSession(true);
          setCompletionPrompt("study-complete");
          notifyPomodoro("Pomodoro terminado", "Elige descanso corto o descanso largo.");
          return 0;
        }
        saveSession(true);
        notifyPomodoro("Descanso terminado", "Empieza otra sesion de estudio.");
        setMode("study");
        setRunning(true);
        return durations.study * 60;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, mode, durations, selectedSubjectId, notes, seconds]);

  return {
    selectedSubjectId,
    setSelectedSubjectId,
    selectedSubject,
    mode,
    durations,
    seconds,
    running,
    notes,
    setNotes,
    history,
    completionPrompt,
    setCompletionPrompt,
    start,
    pause,
    reset,
    finish,
    changeMode,
    startBreak,
    updateDuration,
    resetDurations,
    deleteSession,
    clearHistory,
  };
}

function App() {
  const [data, setData] = useState(readStoredData);
  const [view, setView] = useState({ page: "dashboard" });
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [cloudUser, setCloudUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState(isSupabaseConfigured ? "Preparando sincronizacion" : "Modo local");
  const latestDataRef = useRef(data);
  const lastCloudJsonRef = useRef("");
  const skipCloudSaveRef = useRef(false);
  const pomodoro = useGlobalPomodoro(data);

  const applyRemoteData = (remoteData, status = "Sincronizado") => {
    migrateSubjectQuestions(remoteData);
    skipCloudSaveRef.current = true;
    lastCloudJsonRef.current = JSON.stringify(remoteData);
    setData(remoteData);
    setSyncStatus(status);
  };

  const loadCloudSession = async (session) => {
    const savedCode = localStorage.getItem(SYNC_CODE_KEY);
    if (savedCode) return;
    if (!session?.user) {
      setCloudUser(null);
      setSyncStatus(isSupabaseConfigured ? "Sin iniciar sesion" : "Modo local");
      return;
    }

    setCloudUser({ id: session.user.id, email: session.user.email, mode: "email" });
    setSyncStatus("Descargando datos");
    try {
      const remote = await fetchCloudData(session.user.id);
      if (remote?.data) {
        applyRemoteData(remote.data);
      } else {
        await saveCloudData(session.user.id, latestDataRef.current);
        lastCloudJsonRef.current = JSON.stringify(latestDataRef.current);
        setSyncStatus("Sincronizado");
      }
    } catch (error) {
      console.error(error);
      setSyncStatus("Error de sincronizacion");
    }
  };

  const requestCloudSignIn = async (email) => {
    setSyncStatus("Enviando enlace");
    await signInWithEmail(email);
    setSyncStatus("Revisa tu correo");
  };

  const connectWithSyncCode = async (rawCode) => {
    const syncId = normalizeSyncCode(rawCode || createSyncCode());
    if (!/^CAMPUS-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(syncId)) {
      throw new Error("Usa un codigo con formato CAMPUS-XXXXXX-XXXXXX.");
    }
    setSyncStatus("Conectando codigo");
    const remote = await fetchSharedSpace(syncId);
    localStorage.setItem(SYNC_CODE_KEY, syncId);
    setCloudUser({ id: syncId, email: syncId, mode: "code" });
    if (remote?.data) {
      applyRemoteData(remote.data);
    } else {
      await saveSharedSpace(syncId, latestDataRef.current);
      lastCloudJsonRef.current = JSON.stringify(latestDataRef.current);
      setSyncStatus("Sincronizado");
    }
    return syncId;
  };

  const disconnectCloud = async () => {
    localStorage.removeItem(SYNC_CODE_KEY);
    await signOutCloud();
    setCloudUser(null);
    setSyncStatus("Sin iniciar sesion");
  };

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    let active = true;
    const savedCode = localStorage.getItem(SYNC_CODE_KEY);
    if (savedCode) connectWithSyncCode(savedCode).catch((error) => {
      console.error(error);
      setSyncStatus("Error de sincronizacion");
    });
    getCurrentSession().then((session) => active && loadCloudSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) loadCloudSession(session);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!cloudUser) return undefined;
    const subscribe = cloudUser.mode === "code" ? subscribeToSharedSpace : subscribeToCloudData;
    return subscribe(cloudUser.id, (row) => {
      if (!row?.data) return;
      const json = JSON.stringify(row.data);
      if (json === lastCloudJsonRef.current) return;
      migrateSubjectQuestions(row.data);
      lastCloudJsonRef.current = json;
      skipCloudSaveRef.current = true;
      setData(row.data);
      setSyncStatus("Actualizado desde la nube");
    });
  }, [cloudUser?.id]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!cloudUser) return undefined;
    if (skipCloudSaveRef.current) {
      skipCloudSaveRef.current = false;
      return undefined;
    }
    const json = JSON.stringify(data);
    if (json === lastCloudJsonRef.current) return undefined;
    setSyncStatus("Guardando en la nube");
    const timer = window.setTimeout(async () => {
      try {
        if (cloudUser.mode === "code") await saveSharedSpace(cloudUser.id, data);
        else await saveCloudData(cloudUser.id, data);
        lastCloudJsonRef.current = json;
        setSyncStatus("Sincronizado");
      } catch (error) {
        console.error(error);
        setSyncStatus("Error de sincronizacion");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [data, cloudUser?.id, cloudUser?.mode]);

  const allThemes = useMemo(
    () => data.subjects.flatMap((subject) => subject.themes.map((theme) => ({ ...theme, subject }))),
    [data.subjects]
  );

  const stats = useMemo(() => {
    const pendingTasks = data.tasks.filter((task) => !task.done).length;
    const totalThemes = allThemes.length || 1;
    const completedThemes = allThemes.filter((theme) => normalizeStudyState(theme.status) === "estudiado").length;
    return { pendingTasks, totalThemes, completedThemes };
  }, [allThemes, data.subjects, data.tasks]);

  const updateData = (recipe) => setData((current) => recipe(structuredClone(current)));

  const currentSubject = view.subjectId ? data.subjects.find((subject) => subject.id === view.subjectId) : null;
  const currentTheme = currentSubject?.themes.find((theme) => theme.id === view.themeId);

  return (
    <div className="min-h-screen bg-[#f7f4ee] text-slate-900 campus-grid">
      <Shell
        view={view}
        setView={setView}
        subjects={data.subjects}
        query={query}
        setQuery={setQuery}
        openModal={setModal}
        cloudUser={cloudUser}
        syncStatus={syncStatus}
        onCloudSignIn={requestCloudSignIn}
        onCodeSignIn={connectWithSyncCode}
        onCloudSignOut={disconnectCloud}
      >
        {view.page === "dashboard" && (
          <Dashboard
            data={data}
            stats={stats}
            allThemes={allThemes}
            setView={setView}
            openModal={setModal}
            updateData={updateData}
            query={query}
          />
        )}
        {view.page === "subjects" && (
          <SubjectsPage data={data} setView={setView} openModal={setModal} updateData={updateData} query={query} />
        )}
        {view.page === "study-map" && (
          <StudyMapPage data={data} setView={setView} updateData={updateData} />
        )}
        {view.page === "subject" && currentSubject && (
          <SubjectPage subject={currentSubject} setView={setView} openModal={setModal} updateData={updateData} />
        )}
        {view.page === "subject-qa" && currentSubject && (
          <SubjectQAPage subject={currentSubject} openModal={setModal} updateData={updateData} setView={setView} />
        )}
        {view.page === "theme" && currentSubject && currentTheme && (
          <ThemePage subject={currentSubject} theme={currentTheme} openModal={setModal} updateData={updateData} setView={setView} syncStatus={syncStatus} />
        )}
        {view.page === "calendar" && <CalendarPage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "schedule" && <SchedulePage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "tasks" && <TasksPage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "resources" && <ResourcesPage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "pomodoro" && <PomodoroPage data={data} pomodoro={pomodoro} />}
      </Shell>

      <FloatingPomodoro pomodoro={pomodoro} setView={setView} />
      {pomodoro.completionPrompt === "study-complete" && <PomodoroBreakPrompt pomodoro={pomodoro} />}
      {modal && <EditorModal modal={modal} close={() => setModal(null)} data={data} updateData={updateData} />}
    </div>
  );
}

function Shell({ children, view, setView, subjects, query, setQuery, openModal, cloudUser, syncStatus, onCloudSignIn, onCodeSignIn, onCloudSignOut }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const nav = [
    ["dashboard", "Inicio", Sparkles],
    ["subjects", "Asignaturas", BookOpen],
    ["study-map", "Mapa de estudio", Network],
    ["calendar", "Calendario", CalendarDays],
    ["schedule", "Horario", Clock3],
    ["tasks", "Tareas", ListChecks],
    ["resources", "Recursos", LinkIcon],
    ["pomodoro", "Pomodoro", AlarmClock],
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 shrink-0 border-r border-slate-900/10 bg-white/80 p-5 backdrop-blur xl:block">
        <SidebarContent
          nav={nav}
          view={view}
          setView={setView}
          subjects={subjects}
          cloudUser={cloudUser}
          syncStatus={syncStatus}
          onCloudSignIn={onCloudSignIn}
          onCodeSignIn={onCodeSignIn}
          onCloudSignOut={onCloudSignOut}
        />
      </aside>
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button className="absolute inset-0 bg-slate-950/40" onClick={() => setMobileMenuOpen(false)} aria-label="Cerrar menu" />
          <aside className="relative h-full w-[min(86vw,360px)] overflow-y-auto border-r border-slate-900/10 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex justify-end">
              <IconButton icon={X} label="Cerrar menu" onClick={() => setMobileMenuOpen(false)} />
            </div>
            <SidebarContent
              nav={nav}
              view={view}
              setView={(nextView) => {
                setView(nextView);
                setMobileMenuOpen(false);
              }}
              subjects={subjects}
              cloudUser={cloudUser}
              syncStatus={syncStatus}
              onCloudSignIn={onCloudSignIn}
              onCodeSignIn={onCodeSignIn}
              onCloudSignOut={onCloudSignOut}
            />
          </aside>
        </div>
      )}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-900/10 bg-[#f7f4ee]/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-[#172033] shadow-sm xl:hidden"
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-900/10 bg-white pl-10 pr-3 text-sm outline-none ring-[#2f6f73]/20 focus:ring-4"
                placeholder="Buscar temas, tareas o recursos"
              />
            </div>
            <QuickButton icon={Plus} label="Asignatura" onClick={() => openModal({ type: "subject" })} />
            <QuickButton icon={ListChecks} label="Tarea" onClick={() => openModal({ type: "task" })} />
            <QuickButton icon={LinkIcon} label="Recurso" onClick={() => openModal({ type: "resource" })} />
            <QuickButton icon={FileText} label="Apunte" onClick={() => openModal({ type: "quick-note" })} />
            <CloudSyncButton user={cloudUser} status={syncStatus} onSignIn={onCloudSignIn} onCodeSignIn={onCodeSignIn} onSignOut={onCloudSignOut} />
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">{children}</div>
      </main>
      <div className="fixed bottom-5 right-4 z-50 md:hidden">
        <CloudSyncButton
          user={cloudUser}
          status={syncStatus}
          onSignIn={onCloudSignIn}
          onCodeSignIn={onCodeSignIn}
          onSignOut={onCloudSignOut}
          mobile
        />
      </div>
    </div>
  );
}

function SidebarContent({ nav, view, setView, subjects, cloudUser, syncStatus, onCloudSignIn, onCodeSignIn, onCloudSignOut }) {
  return (
    <>
      <button onClick={() => setView({ page: "dashboard" })} className="mb-8 flex items-center gap-3 text-left">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-[#172033] text-white">
          <Sparkles size={22} />
        </span>
        <span>
          <span className="block text-lg font-black">AppStudios</span>
          <span className="text-sm text-slate-500">Estudio inteligente</span>
        </span>
      </button>
      <nav className="space-y-1">
        {nav.map(([page, label, Icon]) => (
          <button
            key={page}
            onClick={() => setView({ page })}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
              view.page === page ? "bg-[#dcebdc] text-[#1f5d55]" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="mt-4">
        <CloudSyncButton
          user={cloudUser}
          status={syncStatus}
          onSignIn={onCloudSignIn}
          onCodeSignIn={onCodeSignIn}
          onSignOut={onCloudSignOut}
          full
        />
      </div>
      <div className="mt-8">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Asignaturas</p>
        <div className="space-y-2">
          {subjects.slice(0, 6).map((subject) => (
            <button
              key={subject.id}
              onClick={() => setView({ page: "subject", subjectId: subject.id })}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100"
            >
              <ColorIcon subject={subject} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{subject.name}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function CloudSyncButton({ user, status, onSignIn, onCodeSignIn, onSignOut, full = false, mobile = false }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(user?.email || "");
  const [syncCode, setSyncCode] = useState("");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await onSignIn(email);
    } catch (syncError) {
      setError(syncError.message || "No se ha podido iniciar sesion.");
    }
  };

  const connectCode = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const code = await onCodeSignIn(syncCode || createSyncCode());
      setSyncCode(code);
    } catch (syncError) {
      setError(syncError.message || "No se ha podido conectar con ese codigo.");
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className={`${full ? "inline-flex w-full justify-center" : mobile ? "inline-flex" : "hidden md:inline-flex"} h-11 items-center gap-2 rounded-lg px-4 text-sm font-black shadow-sm ${
          user ? "bg-[#dcebdc] text-[#1f5d55]" : "bg-white text-slate-700"
        }`}
        title="Sincronizacion"
      >
        <Cloud size={18} />
        {user ? "Sync" : "Nube"}
      </button>
      {open && (
        <div className={`${mobile ? "fixed bottom-20 left-4 right-4" : "absolute right-0 top-12 w-80"} z-50 rounded-lg border border-slate-900/10 bg-white p-4 shadow-soft`}>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#dcebdc] text-[#1f5d55]">
              <Cloud size={19} />
            </span>
            <div>
              <h2 className="font-black">Sincronizacion</h2>
              <p className="text-sm text-slate-500">{status}</p>
            </div>
          </div>

          {!isSupabaseConfigured ? (
            <p className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm font-bold text-yellow-800">
              Falta configurar Supabase en el archivo .env para activar la nube.
            </p>
          ) : user ? (
            <div className="mt-4 space-y-3">
              <p className="truncate rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-600">{user.mode === "code" ? `Codigo: ${user.email}` : user.email}</p>
              <button onClick={onSignOut} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-black text-slate-700">
                <LogOut size={16} /> Cerrar sesion
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <form onSubmit={connectCode} className="space-y-3 rounded-lg bg-slate-50 p-3">
                <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Codigo de sincronizacion</label>
                <input value={syncCode} onChange={(event) => setSyncCode(event.target.value)} className="input" placeholder="CAMPUS-XXXXXX-XXXXXX" />
                <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#172033] px-3 text-sm font-black text-white">
                  <Cloud size={16} /> Conectar codigo
                </button>
                <p className="text-xs text-slate-500">Dejalo vacio para crear uno nuevo. Usa el mismo codigo en tus otros dispositivos.</p>
              </form>

              <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-4">
                <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Email</label>
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="input" placeholder="tu@email.com" />
                <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-black text-slate-700">
                  <Mail size={16} /> Enviar enlace
                </button>
              </form>
              {error && <p className="text-sm font-bold text-red-600">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Dashboard({ data, stats, allThemes, setView, openModal, updateData, query }) {
  const filteredSubjects = filterItems(data.subjects, query, ["name", "description"]);
  const upcomingEvents = [...data.events].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const pendingTasks = filterItems(data.tasks.filter((task) => !task.done), query, ["title", "priority"]);

  return (
    <div className="space-y-6">
      <section className="relative min-h-[500px] overflow-hidden rounded-lg bg-cover bg-[center_45%] shadow-soft" style={{ backgroundImage: "url('/appstudios-dashboard.png')" }}>
        <div className="absolute inset-0 bg-gradient-to-r from-sky-950/10 via-transparent to-transparent" />
        <div className="relative flex min-h-[500px] items-center p-5 md:p-8">
          <div className="w-full max-w-xl rounded-lg border border-white/35 bg-sky-950/10 p-5 text-white shadow-soft backdrop-blur-[3px] md:p-7">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1f5d55]">Dashboard principal</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-black leading-tight drop-shadow md:text-6xl">AppStudios</h1>
            <div className="mt-5 h-1 w-16 rounded-full bg-emerald-300" />
            <p className="mt-6 max-w-xl text-base font-semibold leading-relaxed text-white md:text-xl">
              Organiza tus asignaturas, apunta mejor y avanza paso a paso hasta tu meta.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <DashboardAction icon={BookOpen} label="Nueva asignatura" tone="green" onClick={() => openModal({ type: "subject" })} />
              <DashboardAction icon={ListChecks} label="Nueva tarea" tone="blue" onClick={() => openModal({ type: "task" })} />
              <DashboardAction icon={Paperclip} label="Nuevo recurso" tone="purple" onClick={() => openModal({ type: "resource" })} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {filteredSubjects.map((subject) => (
          <SubjectCard key={subject.id} subject={subject} setView={setView} openModal={openModal} updateData={updateData} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="grid gap-4">
          <Panel title="Tareas pendientes" icon={ListChecks} action={() => openModal({ type: "task" })}>
            <TaskList tasks={pendingTasks.slice(0, 6)} data={data} updateData={updateData} openModal={openModal} />
          </Panel>
          <Panel title="Calendario" icon={CalendarDays} action={() => openModal({ type: "event" })}>
            <MiniCalendar events={upcomingEvents} subjects={data.subjects} />
          </Panel>
        </div>
        <Panel title="Horario semanal" icon={Clock3} action={() => openModal({ type: "schedule" })}>
          <ScheduleMini blocks={data.scheduleBlocks} subjects={data.subjects} />
        </Panel>
      </section>

      <Panel title="Temas en marcha" icon={BookOpen}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {allThemes
            .filter((theme) => normalizeStudyState(theme.status) !== "estudiado")
            .slice(0, 6)
            .map((theme) => (
              <ThemeCard key={theme.id} theme={theme} subject={theme.subject} setView={setView} openModal={openModal} updateData={updateData} />
            ))}
        </div>
      </Panel>
    </div>
  );
}

function SubjectsPage({ data, setView, openModal, updateData, query }) {
  const subjects = filterItems(data.subjects, query, ["name", "description"]);
  return (
    <div className="space-y-5">
      <PageTitle title="Asignaturas" subtitle="Organiza cada materia como un espacio propio dentro de AppStudios." action={() => openModal({ type: "subject" })} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {subjects.map((subject) => (
          <SubjectCard key={subject.id} subject={subject} setView={setView} openModal={openModal} updateData={updateData} large />
        ))}
      </div>
    </div>
  );
}

function StudyMapPage({ data, setView, updateData }) {
  const enrichedSubjects = data.subjects.map((subject) => {
    const themes = subject.themes.map((theme) => enrichTheme(theme, subject, data.tasks));
    return { ...subject, themes };
  });

  const setThemeStudyState = (subjectId, themeId, status) => {
    updateData((draft) => {
      const target = findTheme(draft, subjectId, themeId);
      if (target) target.status = status;
      return draft;
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-black">Mapa de estudio</h1>
          <p className="mt-1 text-slate-600">Esquema global compacto de asignaturas y temas.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {enrichedSubjects.map((subject) => (
          <StudySubjectMap key={subject.id} subject={subject} setView={setView} setThemeStudyState={setThemeStudyState} />
        ))}
      </div>
    </div>
  );
}

function StudySubjectMap({ subject, setView, setThemeStudyState }) {
  return (
    <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
      <button
        onClick={() => setView({ page: "subject", subjectId: subject.id })}
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-slate-50"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white shadow-sm" style={{ background: subject.color }}>
          {(() => {
            const Icon = iconMap[subject.icon] || BookOpen;
            return <Icon size={21} />;
          })()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-lg font-black">{subject.name}</span>
          <span className="text-xs font-bold uppercase text-slate-400">{subject.themes.length} temas</span>
        </span>
      </button>

      <div className="relative ml-5 mt-3 border-l-2 border-slate-200 pl-5">
        {subject.themes.length === 0 && <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-400">Sin temas</span>}
        <div className="space-y-2">
          {subject.themes.map((theme) => (
            <StudyThemeNode
              key={theme.id}
              subject={subject}
              theme={theme}
              setView={setView}
              setThemeStudyState={setThemeStudyState}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function StudyThemeNode({ subject, theme, setView, setThemeStudyState }) {
  const tone = stateTone(theme.studyState);
  return (
    <div className="relative rounded-lg border border-slate-900/10 bg-slate-50 p-2">
      <span className="absolute -left-[22px] top-5 h-0.5 w-5 bg-slate-200" />
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: tone.dot }} />
        <button
          onClick={() => setView({ page: "theme", subjectId: subject.id, themeId: theme.id })}
          className="min-w-0 flex-1 truncate text-left text-sm font-black hover:text-[#1f5d55]"
          title={theme.name}
        >
          {theme.name}
        </button>
      </div>
      <div className="mt-2 flex gap-1">
        {studyStateOptions.map((option) => {
          const optionTone = stateTone(option.id);
          const active = theme.studyState === option.id;
          return (
            <button
              key={option.id}
              type="button"
              title={option.label}
              onClick={() => setThemeStudyState(subject.id, theme.id, option.id)}
              className={`h-6 flex-1 rounded border text-[10px] font-black uppercase transition ${
                active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 opacity-75"
              }`}
              style={{ background: optionTone.soft }}
            >
              {option.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SubjectPage({ subject, setView, openModal, updateData }) {
  const [activeSection, setActiveSection] = useState("teoria");
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const studySections = useMemo(() => getSubjectStudySections(subject), [subject.studySections]);
  const allSections = useMemo(() => getAllSubjectSections(subject), [subject.studySections, subject.questionsLabel]);
  const activeStudySection = studySections.find((section) => section.id === activeSection);
  const qaCount = subject.qa?.length || 0;
  const dominatedCount = subject.qa?.filter((item) => item.status === "dominada").length || 0;
  const sectionThemes = subject.themes.filter((theme) => (theme.section || "teoria") === activeSection);
  useEffect(() => {
    if (activeSection !== "preguntas" && !studySections.some((section) => section.id === activeSection)) {
      setActiveSection(studySections[0]?.id || "teoria");
    }
  }, [activeSection, studySections, subject.id]);
  const changeThemeSection = (themeId, section) => {
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id)?.themes.find((theme) => theme.id === themeId);
      if (target) target.section = section;
      return draft;
    });
  };
  const addSubjectSection = () => {
    const label = window.prompt("Nombre del nuevo apartado");
    if (!label?.trim()) return;
    const nextId = createId("section");
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id);
      if (!target) return draft;
      target.studySections = [...getSubjectStudySections(target), { id: nextId, label: label.trim() }];
      return draft;
    });
    setActiveSection(nextId);
    setSectionsOpen(false);
  };
  const renameSubjectSection = (section) => {
    const label = window.prompt("Nuevo nombre del apartado", section.label);
    if (!label?.trim()) return;
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id);
      if (!target) return draft;
      target.studySections = getSubjectStudySections(target).map((item) => (item.id === section.id ? { ...item, label: label.trim() } : item));
      return draft;
    });
  };
  const renameQuestionsSection = () => {
    const label = window.prompt("Nuevo nombre del apartado de preguntas", subject.questionsLabel || "Preguntas");
    if (!label?.trim()) return;
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id);
      if (target) target.questionsLabel = label.trim();
      return draft;
    });
  };
  const deleteSubjectSection = (sectionId) => {
    if (studySections.length <= 1) {
      window.alert("Debe quedar al menos un apartado para los temas.");
      return;
    }
    if (!window.confirm("Eliminar este apartado? Los temas se moveran a otro apartado.")) return;
    const remaining = studySections.filter((section) => section.id !== sectionId);
    const fallback = remaining[0]?.id || "teoria";
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id);
      if (!target) return draft;
      target.studySections = remaining;
      target.themes.forEach((theme) => {
        if ((theme.section || "teoria") === sectionId) theme.section = fallback;
      });
      return draft;
    });
    if (activeSection === sectionId) setActiveSection(fallback);
  };
  return (
    <div className="space-y-5">
      <button onClick={() => setView({ page: "subjects" })} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900">
        <ChevronLeft size={18} /> Asignaturas
      </button>
      <section className="rounded-lg p-6 text-white shadow-soft" style={{ background: subject.color }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <ColorIcon subject={subject} light />
            <h1 className="mt-4 text-4xl font-black">{subject.name}</h1>
            <p className="mt-2 max-w-2xl text-white/80">{subject.description}</p>
          </div>
          <div className="flex gap-2">
            <ActionButton icon={Pencil} label="Editar" onClick={() => openModal({ type: "subject", item: subject })} />
            <ActionButton icon={Plus} label="Tema" onClick={() => openModal({ type: "theme", subjectId: subject.id, section: activeSection === "preguntas" ? studySections[0]?.id || "teoria" : activeSection })} />
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-slate-900/10 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {allSections.map((section) => {
            const count = section.id === "preguntas" ? qaCount : subject.themes.filter((theme) => (theme.section || "teoria") === section.id).length;
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`rounded-lg px-4 py-3 text-sm font-black transition ${active ? "bg-[#172033] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
              >
                {section.label} <span className={active ? "text-white/70" : "text-slate-400"}>{count}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSectionsOpen((value) => !value)}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg bg-slate-100 px-3 text-xs font-black text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
          >
            <Pencil size={15} /> Apartados
          </button>
        </div>
      </section>
      {sectionsOpen && (
        <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Modificar apartados</h2>
              <p className="text-sm text-slate-500">Cambia los nombres, anade apartados o elimina los que no uses.</p>
            </div>
            <button type="button" onClick={addSubjectSection} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#172033] px-3 text-sm font-black text-white">
              <Plus size={16} /> Anadir
            </button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {studySections.map((section) => (
              <div key={section.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-900/10 bg-slate-50 p-2">
                <span className="truncate px-2 text-sm font-black text-slate-700">{section.label}</span>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => renameSubjectSection(section)} className="rounded-lg bg-white px-2 py-2 text-xs font-black text-slate-600 shadow-sm hover:text-slate-900">
                    Editar
                  </button>
                  <button type="button" onClick={() => deleteSubjectSection(section.id)} className="rounded-lg bg-rose-50 px-2 py-2 text-xs font-black text-rose-700 shadow-sm hover:bg-rose-100">
                    Borrar
                  </button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
              <span className="truncate px-2 text-sm font-black text-emerald-800">{subject.questionsLabel || "Preguntas"}</span>
              <button type="button" onClick={renameQuestionsSection} className="rounded-lg bg-white px-2 py-2 text-xs font-black text-emerald-800 shadow-sm hover:text-emerald-950">
                Editar nombre
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs font-bold text-slate-400">El apartado de preguntas se puede renombrar, pero no borrar, porque guarda el banco de preguntas de la asignatura.</p>
        </section>
      )}
      {activeSection === "preguntas" ? (
        <section className="rounded-lg border border-slate-900/10 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">Preguntas y respuestas</h2>
              <p className="mt-1 text-sm text-slate-500">{qaCount} preguntas · {dominatedCount} dominadas</p>
            </div>
            <button onClick={() => setView({ page: "subject-qa", subjectId: subject.id })} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white">
              <HelpCircle size={18} /> Abrir preguntas
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">{activeStudySection?.label || "Apartado"}</h2>
              <p className="text-sm text-slate-500">Temas de este apartado de la asignatura.</p>
            </div>
            <button onClick={() => openModal({ type: "theme", subjectId: subject.id, section: activeSection })} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white">
              <Plus size={18} /> Añadir aquí
            </button>
          </div>
          {sectionThemes.length === 0 ? (
            <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
              <p className="font-black text-slate-500">Todavía no hay temas en este apartado.</p>
            </section>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {sectionThemes.map((theme) => (
                <ThemeCard key={theme.id} theme={theme} subject={subject} setView={setView} openModal={openModal} updateData={updateData} onSectionChange={changeThemeSection} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ThemePage({ subject, theme, openModal, updateData, setView, syncStatus }) {
  const fileInputRef = useRef(null);
  const [savedAt, setSavedAt] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState({ includeToc: true, includeImages: true });
  const documentHtml = theme.documentHtml || buildThemeDocument(theme);

  const addFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileId = await saveStoredFile(file);
    updateData((draft) => {
      const target = findTheme(draft, subject.id, theme.id);
      target.media.push({ id: createId("media"), type: file.type.includes("pdf") ? "pdf" : "image", name: file.name, mime: file.type, fileId });
      return draft;
    });
    event.target.value = "";
  };

  const updateDocument = (html) => {
    updateData((draft) => {
      const target = findTheme(draft, subject.id, theme.id);
      target.documentHtml = html;
      return draft;
    });
    setSavedAt(new Date());
  };

  const createQuestionFromSelection = (text) => {
    const clean = text.trim();
    if (!clean) return;
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id);
      if (!target.qa) target.qa = [];
      target.qa.push({
        id: createId("qa"),
        question: `Explica: ${clean}`,
        answer: "",
        status: "pendiente",
        sourceThemeId: theme.id,
        sourceThemeName: theme.name,
      });
      return draft;
    });
  };

  const deleteFile = (fileId) => {
    updateData((draft) => {
      const target = findTheme(draft, subject.id, theme.id);
      target.media = target.media.filter((file) => file.id !== fileId);
      return draft;
    });
  };

  return (
    <div className="space-y-5">
      <button onClick={() => setView({ page: "subject", subjectId: subject.id })} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900">
        <ChevronLeft size={18} /> {subject.name}
      </button>
      <section className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="font-black uppercase tracking-[0.18em] text-slate-400">{subject.name}</p>
            <h1 className="mt-2 text-4xl font-black">{theme.name}</h1>
            <p className="mt-2 max-w-3xl text-slate-600">{theme.description}</p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <button onClick={() => setExportOptionsOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white shadow-sm hover:bg-[#22304a]">
              <FileText size={18} /> Exportar tema a PDF
            </button>
            <Badge>{theme.status}</Badge>
            <Badge tone={theme.priority === "alta" ? "hot" : "cool"}>{theme.priority}</Badge>
            <IconButton icon={Pencil} label="Editar tema" onClick={() => openModal({ type: "theme", subjectId: subject.id, item: theme })} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <RichTextEditor key={theme.id} value={documentHtml} onChange={updateDocument} onCreateQuestion={createQuestionFromSelection} />
        <aside className="space-y-4">
          <ThemeDocumentIndex html={documentHtml} />
          <ThemeSection title="PDFs e imágenes" icon={Paperclip} onAdd={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={addFile} />
            {theme.media.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">
                Añade PDFs, capturas o imágenes para tenerlos junto a tus apuntes.
              </div>
            ) : (
              <div className="grid gap-2">
                {theme.media.map((file) => (
                  <StoredFileLink key={file.id} file={file} onPreview={() => setPreviewFile(file)} onDelete={() => deleteFile(file.id)} />
                ))}
              </div>
            )}
          </ThemeSection>
          <section className="rounded-lg border border-slate-900/10 bg-white p-4">
            <h2 className="flex items-center gap-2 font-black"><Save size={18} /> Guardado</h2>
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">{syncStatus}</p>
            <p className="mt-2 text-sm text-slate-600">El documento se guarda automáticamente en este navegador mientras escribes.</p>
          </section>
        </aside>
      </div>
      {previewFile && <FilePreviewModal file={previewFile} close={() => setPreviewFile(null)} />}
      {exportOptionsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Exportar PDF</h2>
                <p className="text-sm text-slate-500">Elige que entra en tus apuntes.</p>
              </div>
              <IconButton icon={X} label="Cerrar" onClick={() => setExportOptionsOpen(false)} />
            </div>
            <label className="mt-4 flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm font-bold">
              <input type="checkbox" checked={exportOptions.includeToc} onChange={(event) => setExportOptions((current) => ({ ...current, includeToc: event.target.checked }))} />
              Incluir indice
            </label>
            <label className="mt-2 flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm font-bold">
              <input type="checkbox" checked={exportOptions.includeImages} onChange={(event) => setExportOptions((current) => ({ ...current, includeImages: event.target.checked }))} />
              Incluir imagenes
            </label>
            <button
              onClick={() => {
                setExportOptionsOpen(false);
                exportThemeToPdf(subject, theme, exportOptions);
              }}
              className="mt-4 h-11 w-full rounded-lg bg-[#172033] text-sm font-black text-white"
            >
              Exportar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeDocumentIndex({ html }) {
  const headings = useMemo(() => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html || "", "text/html");
    return Array.from(doc.querySelectorAll("h1, h2, h3, h4"))
      .filter((heading) => !heading.closest(".auto-toc"))
      .map((heading, index) => ({
        id: heading.id || `theme-index-${index}`,
        level: Number(heading.tagName.replace("H", "")),
        text: heading.textContent.trim(),
      }))
      .filter((heading) => heading.text);
  }, [html]);

  const jumpToHeading = (target) => {
    const editor = document.querySelector(".study-document");
    const heading = Array.from(editor?.querySelectorAll("h1, h2, h3, h4") || []).find(
      (item) => !item.closest(".auto-toc") && item.textContent.trim() === target.text,
    );
    heading?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 font-black"><BookOpen size={18} /> Indice</h2>
      {headings.length === 0 ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-400">Sin titulos todavia.</p>
      ) : (
        <div className="mt-3 max-h-[360px] space-y-1 overflow-auto pr-1">
          {headings.map((heading) => (
            <button
              key={`${heading.id}-${heading.text}`}
              type="button"
              onClick={() => jumpToHeading(heading)}
              className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm font-black hover:bg-slate-50 ${heading.level > 2 ? "pl-6 text-slate-500" : "text-[#1f5d55]"}`}
            >
              {heading.text}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function RichTextEditor({ value, onChange, onCreateQuestion }) {
  const editorRef = useRef(null);
  const editorFrameRef = useRef(null);
  const fileInputRef = useRef(null);
  const savedRangeRef = useRef(null);
  const draggingImageRef = useRef(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageWidth, setImageWidth] = useState(70);
  const [imageTools, setImageTools] = useState(null);
  const [draggingImage, setDraggingImage] = useState(null);
  const [imageDropIndicator, setImageDropIndicator] = useState(null);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [blockTools, setBlockTools] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableTools, setTableTools] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = value || emptyThemeDocument();
    normalizeEditableBlocks(editorRef.current);
    prepareEditorTables();
    prepareEditorImages();
    refreshToc();
    ensureEditableParagraph(editorRef.current);
  }, []);

  const saveDocument = () => {
    normalizeEditableBlocks(editorRef.current);
    prepareEditorTables();
    prepareEditorImages();
    refreshToc();
    ensureEditableParagraph(editorRef.current);
    onChange(editorRef.current?.innerHTML || "");
  };

  const refreshToc = () => {
    if (!editorRef.current) return;
    updateDocumentToc(editorRef.current);
  };

  const selectionIsInsideEditor = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return false;
    const node = selection.anchorNode;
    return !!node && editorRef.current.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  };

  const saveSelection = () => {
    if (!selectionIsInsideEditor()) return;
    const selection = window.getSelection();
    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    editorRef.current?.focus();
    if (!savedRangeRef.current) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRangeRef.current);
  };

  const runCommand = (command, commandValue = null) => {
    restoreSelection();
    document.execCommand(command, false, commandValue);
    saveSelection();
    saveDocument();
  };

  const getCurrentEditableBlock = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return null;
    let node = selection.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return node?.closest?.("h1, h2, h3, h4, p, blockquote, li, div, pre") || null;
  };

  const toggleFormatBlock = (tag) => {
    restoreSelection();
    const currentBlock = getCurrentEditableBlock();
    const currentTag = currentBlock?.tagName?.toLowerCase();
    document.execCommand("formatBlock", false, currentTag === tag ? "p" : tag);
    saveSelection();
    saveDocument();
  };

  const changeSelectionFontSize = (delta) => {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !editorRef.current) return;
    const anchor = selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode;
    const currentSize = Number.parseFloat(window.getComputedStyle(anchor || editorRef.current).fontSize) || 18;
    const nextSize = Math.min(44, Math.max(11, currentSize + delta));
    const range = selection.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = `${nextSize}px`;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(newRange);
    savedRangeRef.current = newRange.cloneRange();
    saveDocument();
  };

  const insertHtml = (html) => {
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    saveSelection();
    saveDocument();
  };

  const insertStudyBlock = (type) => {
    const blocks = {
      definicion: {
        title: "Definicion",
        tone: "blue",
        body: "Explica aqui el concepto teorico y sus partes importantes.",
      },
      idea: {
        title: "Idea clave",
        tone: "green",
        body: "Resume en pocas lineas lo mas importante de este apartado.",
      },
      algoritmo: {
        title: "Algoritmo / Pseudocodigo",
        tone: "purple",
        body: "Escribe los pasos del algoritmo o el pseudocodigo principal.",
      },
      complejidad: {
        title: "Complejidad",
        tone: "amber",
        body: "Temporal: O(...). Espacial: O(...). Explica por que.",
      },
      recurrencia: {
        title: "Caso base / Recurrencia",
        tone: "rose",
        body: "Caso base: ...\nRecurrencia: ...",
      },
      ejemplo: {
        title: "Ejemplo",
        tone: "cyan",
        body: "Planteamiento, desarrollo paso a paso y resultado.",
      },
      error: {
        title: "Error tipico",
        tone: "orange",
        body: "Describe el fallo frecuente y como evitarlo en el examen.",
      },
      pregunta: {
        title: "Pregunta de examen",
        tone: "indigo",
        body: "Escribe una posible pregunta teorica importante y su respuesta.",
      },
      duda: {
        title: "Duda",
        tone: "slate",
        body: "Apunta que no entiendes y que necesitas revisar.",
      },
    };
    const block = blocks[type];
    if (!block) return;
    insertHtml(`
      <section class="study-block study-block-${block.tone} study-content-normal" contenteditable="false" data-study-block="true" data-block-size="normal">
        <div class="study-block-label">${escapeHtml(block.title)}</div>
        <div class="study-block-body" contenteditable="true">${escapeHtml(block.body).replace(/\n/g, "<br>")}</div>
      </section><p><br></p>
    `);
  };

  const insertCodeBlock = (language) => {
    const labels = {
      cpp: "C++",
      javascript: "JavaScript",
      htmlcss: "HTML / CSS",
      python: "Python",
      php: "PHP",
      pseudocode: "Pseudocodigo",
      text: "Texto plano",
    };
    const label = labels[language];
    if (!label) return;
    insertHtml(`
      <section class="study-code-block study-content-normal" contenteditable="false" data-code-language="${escapeHtml(label)}" data-study-block="true" data-block-size="normal">
        <div class="study-code-header">
          <span><strong>Codigo</strong> · ${escapeHtml(label)}</span>
          <span class="study-code-actions">
            <button type="button" data-code-action="copy" contenteditable="false">Copiar</button>
            <button type="button" data-code-action="edit" contenteditable="false">Editar</button>
            <button type="button" data-code-action="delete" contenteditable="false">Eliminar</button>
          </span>
        </div>
        <pre class="study-code-content" contenteditable="true">Escribe aqui tu codigo...</pre>
      </section><p><br></p>
    `);
  };

  const insertComparisonTable = () => {
    insertHtml(`
      <table class="study-table" data-study-table="true">
        <thead>
          <tr><th><br></th><th><br></th><th><br></th></tr>
        </thead>
        <tbody>
          <tr><td><br></td><td><br></td><td><br></td></tr>
          <tr><td><br></td><td><br></td><td><br></td></tr>
        </tbody>
      </table><p><br></p>
    `);
  };

  const createQuestionFromSelection = () => {
    const text = window.getSelection()?.toString() || "";
    if (text.trim()) onCreateQuestion?.(text);
  };

  const addInlineImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => insertImageAtCursor(reader.result, file.name);
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const insertImageAtCursor = (src, alt) => {
    restoreSelection();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange();
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt || "Imagen del apunte";
    image.style.width = "70%";
    image.style.display = "block";
    image.style.margin = "1rem auto";
    image.dataset.editableImage = "true";
    image.draggable = true;

    const nextLine = document.createElement("p");
    nextLine.innerHTML = "<br>";

    range.deleteContents();
    range.insertNode(nextLine);
    range.insertNode(image);

    const newRange = document.createRange();
    newRange.setStart(nextLine, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    savedRangeRef.current = newRange.cloneRange();
    setSelectedImage(image);
    setImageWidth(70);
    updateImageToolsPosition(image);
    saveDocument();
  };

  const handleEditorClick = (event) => {
    const tocDelete = event.target?.closest?.("[data-toc-delete]");
    if (tocDelete) {
      event.preventDefault();
      event.stopPropagation();
      deleteSectionFromToc(tocDelete.dataset.tocDelete);
      return;
    }

    const codeAction = event.target?.closest?.("[data-code-action]");
    if (codeAction) {
      event.preventDefault();
      const codeBlock = codeAction.closest(".study-code-block");
      const codeContent = codeBlock?.querySelector(".study-code-content");
      const action = codeAction.dataset.codeAction;
      if (action === "copy") {
        navigator.clipboard?.writeText(codeContent?.innerText || "");
      }
      if (action === "edit" && codeContent) {
        unhighlightCodeElement(codeContent);
        codeContent.focus();
        const range = document.createRange();
        range.selectNodeContents(codeContent);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedRangeRef.current = range.cloneRange();
      }
      if (action === "delete") {
        codeBlock?.remove();
        saveDocument();
      }
      return;
    }
    const table = event.target?.closest?.(".study-table");
    if (table && editorRef.current?.contains(table)) {
      selectedImage?.classList.remove("selected-editor-image");
      selectedBlock?.classList.remove("selected-study-block");
      selectedTable?.classList.remove("selected-study-table");
      table.classList.add("selected-study-table");
      setSelectedImage(null);
      setImageTools(null);
      setSelectedBlock(null);
      setBlockTools(null);
      setSelectedTable(table);
      updateTableToolsPosition(table);
      saveSelection();
      return;
    }
    const block = event.target?.closest?.("[data-study-block], .study-block, .study-code-block");
    if (block && editorRef.current?.contains(block)) {
      selectedImage?.classList.remove("selected-editor-image");
      selectedBlock?.classList.remove("selected-study-block");
      selectedTable?.classList.remove("selected-study-table");
      block.classList.add("selected-study-block");
      setSelectedImage(null);
      setImageTools(null);
      setSelectedTable(null);
      setTableTools(null);
      setSelectedBlock(block);
      updateBlockToolsPosition(block);
      saveSelection();
      return;
    }
    if (event.target?.tagName === "IMG") {
      selectedImage?.classList.remove("selected-editor-image");
      selectedBlock?.classList.remove("selected-study-block");
      selectedTable?.classList.remove("selected-study-table");
      event.target.classList.add("selected-editor-image");
      setSelectedImage(event.target);
      setSelectedBlock(null);
      setBlockTools(null);
      setSelectedTable(null);
      setTableTools(null);
      const width = Number.parseInt(event.target.style.width, 10);
      setImageWidth(Number.isFinite(width) ? width : 70);
      updateImageToolsPosition(event.target);
      return;
    }
    selectedImage?.classList.remove("selected-editor-image");
    selectedBlock?.classList.remove("selected-study-block");
    selectedTable?.classList.remove("selected-study-table");
    setSelectedImage(null);
    setImageTools(null);
    setSelectedBlock(null);
    setBlockTools(null);
    setSelectedTable(null);
    setTableTools(null);
    saveSelection();
  };

  const handleEditorFocus = (event) => {
    const codeContent = event.target?.closest?.(".study-code-content");
    if (!codeContent || !editorRef.current?.contains(codeContent)) return;
    unhighlightCodeElement(codeContent);
  };

  const handleEditorBlur = (event) => {
    const codeContent = event.target?.closest?.(".study-code-content");
    if (!codeContent || !editorRef.current?.contains(codeContent)) return;
    highlightCodeElement(codeContent);
    saveDocument();
  };

  const handleEditorKeyDown = (event) => {
    if (event.key !== "Tab") return;
    if (!editorRef.current?.contains(event.target)) return;
    event.preventDefault();
    const codeContent = event.target?.closest?.(".study-code-content");
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const tab = document.createTextNode(codeContent ? "  " : "\u00a0\u00a0\u00a0\u00a0");
    range.insertNode(tab);
    range.setStartAfter(tab);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRangeRef.current = range.cloneRange();
    saveDocument();
  };

  const deleteSectionFromToc = (headingId) => {
    if (!headingId || !editorRef.current) return;
    const heading = editorRef.current.querySelector(`#${CSS.escape(headingId)}`);
    if (!heading) return;
    heading.remove();
    saveDocument();
  };

  const handlePaste = (event) => {
    const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith("image/"));
    if (!imageItem) {
      window.setTimeout(() => {
        saveSelection();
        saveDocument();
      }, 0);
      return;
    }
    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => insertImageAtCursor(reader.result, "Imagen pegada");
    reader.readAsDataURL(file);
  };

  const resizeSelectedImage = (width) => {
    if (!selectedImage) return;
    selectedImage.style.width = `${width}%`;
    selectedImage.style.maxWidth = "100%";
    setImageWidth(width);
    window.requestAnimationFrame(() => updateImageToolsPosition(selectedImage));
    saveDocument();
  };

  const alignSelectedImage = (align) => {
    if (!selectedImage) return;
    applyImageAlignment(selectedImage, align);
    window.requestAnimationFrame(() => updateImageToolsPosition(selectedImage));
    saveDocument();
  };

  const applyImageAlignment = (image, align) => {
    image.style.float = "";
    image.style.display = "block";
    image.style.margin = "1rem auto";
    if (align === "left") {
      image.style.float = "left";
      image.style.margin = "0.5rem 1.25rem 0.75rem 0";
    }
    if (align === "right") {
      image.style.float = "right";
      image.style.margin = "0.5rem 0 0.75rem 1.25rem";
    }
    if (align === "center") {
      image.style.float = "";
      image.style.margin = "1rem auto";
    }
  };

  const deleteSelectedImage = () => {
    if (!selectedImage) return;
    selectedImage.remove();
    setSelectedImage(null);
    setImageTools(null);
    saveDocument();
  };

  const resizeSelectedBlock = (size) => {
    if (!selectedBlock) return;
    selectedBlock.classList.remove("study-content-small", "study-content-normal", "study-content-large");
    selectedBlock.classList.add(`study-content-${size}`);
    selectedBlock.dataset.blockSize = size;
    window.requestAnimationFrame(() => updateBlockToolsPosition(selectedBlock));
    saveDocument();
  };

  const deleteSelectedBlock = () => {
    if (!selectedBlock) return;
    selectedBlock.remove();
    setSelectedBlock(null);
    setBlockTools(null);
    saveDocument();
  };

  const getSelectedTableColumnCount = () => {
    const firstRow = selectedTable?.rows?.[0];
    return firstRow?.cells?.length || 0;
  };

  const addTableRow = () => {
    if (!selectedTable) return;
    const tbody = selectedTable.tBodies[0] || selectedTable.createTBody();
    const columns = Math.max(1, getSelectedTableColumnCount());
    const row = tbody.insertRow();
    for (let index = 0; index < columns; index += 1) {
      row.insertCell().innerHTML = "<br>";
    }
    window.requestAnimationFrame(() => updateTableToolsPosition(selectedTable));
    saveDocument();
  };

  const removeTableRow = () => {
    if (!selectedTable) return;
    const tbody = selectedTable.tBodies[0];
    if (!tbody || tbody.rows.length <= 1) return;
    tbody.deleteRow(tbody.rows.length - 1);
    window.requestAnimationFrame(() => updateTableToolsPosition(selectedTable));
    saveDocument();
  };

  const addTableColumn = () => {
    if (!selectedTable) return;
    Array.from(selectedTable.rows).forEach((row) => {
      const cell = row.parentElement?.tagName === "THEAD" ? document.createElement("th") : document.createElement("td");
      cell.innerHTML = "<br>";
      row.appendChild(cell);
    });
    window.requestAnimationFrame(() => updateTableToolsPosition(selectedTable));
    saveDocument();
  };

  const removeTableColumn = () => {
    if (!selectedTable) return;
    const columns = getSelectedTableColumnCount();
    if (columns <= 1) return;
    Array.from(selectedTable.rows).forEach((row) => row.deleteCell(columns - 1));
    window.requestAnimationFrame(() => updateTableToolsPosition(selectedTable));
    saveDocument();
  };

  const deleteSelectedTable = () => {
    if (!selectedTable) return;
    selectedTable.remove();
    setSelectedTable(null);
    setTableTools(null);
    saveDocument();
  };

  const addImageCaption = () => {
    if (!selectedImage) return;
    const caption = document.createElement("p");
    caption.className = "image-caption";
    caption.textContent = "Pie de imagen";
    selectedImage.insertAdjacentElement("afterend", caption);
    saveDocument();
  };

  const updateImageToolsPosition = (image) => {
    if (!image || !editorFrameRef.current) return;
    const imageRect = image.getBoundingClientRect();
    const frameRect = editorFrameRef.current.getBoundingClientRect();
    setImageTools({
      left: Math.max(12, imageRect.left - frameRect.left),
      top: Math.max(12, imageRect.top - frameRect.top - 54),
      width: imageRect.width,
    });
  };

  const updateBlockToolsPosition = (block) => {
    if (!block || !editorFrameRef.current) return;
    const blockRect = block.getBoundingClientRect();
    const frameRect = editorFrameRef.current.getBoundingClientRect();
    setBlockTools({
      left: Math.max(12, blockRect.left - frameRect.left),
      top: Math.max(12, blockRect.top - frameRect.top - 54),
      width: blockRect.width,
    });
  };

  const updateTableToolsPosition = (table) => {
    if (!table || !editorFrameRef.current) return;
    const tableRect = table.getBoundingClientRect();
    const frameRect = editorFrameRef.current.getBoundingClientRect();
    setTableTools({
      left: Math.max(12, tableRect.left - frameRect.left),
      top: Math.max(12, tableRect.top - frameRect.top - 54),
      width: tableRect.width,
    });
  };

  const prepareEditorImages = () => {
    editorRef.current?.querySelectorAll("img").forEach((image) => {
      image.draggable = true;
      image.setAttribute("draggable", "true");
      image.dataset.editableImage = "true";
    });
  };

  const prepareEditorTables = () => {
    editorRef.current?.querySelectorAll(".study-table").forEach((table) => {
      table.dataset.studyTable = "true";
    });
  };

  const getImageDropPlacement = (event) => {
    if (!editorRef.current || !editorFrameRef.current) return null;
    const editorRect = editorRef.current.getBoundingClientRect();
    const align = event.clientX < editorRect.left + editorRect.width * 0.33 ? "left" : event.clientX > editorRect.left + editorRect.width * 0.67 ? "right" : "center";
    const activeImage = draggingImageRef.current || draggingImage;
    const candidates = Array.from(editorRef.current.children).filter((node) => node !== activeImage && node.nodeType === Node.ELEMENT_NODE);
    const target = candidates.find((node) => {
      const rect = node.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    }) || candidates[candidates.length - 1] || editorRef.current;
    const rect = target.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const frameRect = editorFrameRef.current.getBoundingClientRect();
    return {
      target,
      position,
      align,
      top: (position === "before" ? rect.top : rect.bottom) - frameRect.top,
      left: Math.max(12, editorRect.left - frameRect.left),
      width: editorRect.width,
    };
  };

  const handleImageDragStart = (event) => {
    if (event.target?.tagName !== "IMG") return;
    draggingImageRef.current = event.target;
    setDraggingImage(event.target);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "move-image");
    event.target.classList.add("dragging-editor-image");
  };

  const handleImageDragOver = (event) => {
    if (!draggingImageRef.current && !draggingImage) return;
    event.preventDefault();
    const placement = getImageDropPlacement(event);
    if (placement) setImageDropIndicator(placement);
  };

  const handleImageDrop = (event) => {
    const activeImage = draggingImageRef.current || draggingImage;
    if (!activeImage) return;
    event.preventDefault();
    const placement = getImageDropPlacement(event);
    activeImage.classList.remove("dragging-editor-image");
    if (placement?.target && placement.target !== editorRef.current) {
      if (placement.position === "before") placement.target.before(activeImage);
      else placement.target.after(activeImage);
    } else {
      editorRef.current?.appendChild(activeImage);
    }
    applyImageAlignment(activeImage, placement?.align || "center");
    setSelectedImage(activeImage);
    draggingImageRef.current = null;
    setDraggingImage(null);
    setImageDropIndicator(null);
    window.requestAnimationFrame(() => updateImageToolsPosition(activeImage));
    saveDocument();
  };

  const handleImageDragEnd = () => {
    const activeImage = draggingImageRef.current || draggingImage;
    activeImage?.classList.remove("dragging-editor-image");
    draggingImageRef.current = null;
    setDraggingImage(null);
    setImageDropIndicator(null);
  };

  return (
    <section className={`${fullscreen ? "fixed inset-0 z-50 overflow-auto rounded-none" : "overflow-hidden rounded-lg"} border border-slate-900/10 bg-white shadow-soft`}>
      <div className={`${fullscreen ? "fixed left-0 right-0 top-0" : "fixed left-0 right-0 top-[68px] xl:left-72"} z-40 flex flex-wrap items-center gap-2 border-b border-slate-900/10 bg-slate-50/95 px-3 py-3 shadow-sm backdrop-blur md:px-8`}>
        <EditorTool icon={Heading1} label="Título" onClick={() => toggleFormatBlock("h1")} />
        <EditorTool icon={Heading2} label="Subtítulo 1" onClick={() => toggleFormatBlock("h2")} />
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFormatBlock("h3")} className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100">S2</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFormatBlock("h4")} className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100">S3</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => changeSelectionFontSize(-2)} className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100">A-</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => changeSelectionFontSize(2)} className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100">A+</button>
        <EditorTool icon={Bold} label="Negrita" onClick={() => runCommand("bold")} />
        <EditorTool icon={Italic} label="Cursiva" onClick={() => runCommand("italic")} />
        <EditorTool icon={Underline} label="Subrayado" onClick={() => runCommand("underline")} />
        <EditorTool icon={List} label="Lista" onClick={() => runCommand("insertUnorderedList")} />
        <EditorTool icon={ListOrdered} label="Lista numerada" onClick={() => runCommand("insertOrderedList")} />
        <EditorTool icon={Quote} label="Cita" onClick={() => toggleFormatBlock("blockquote")} />
        <EditorTool icon={Image} label="Imagen dentro del apunte" onClick={() => fileInputRef.current?.click()} />
        <EditorTool icon={Grid3X3} label="Insertar tabla comparativa" onClick={insertComparisonTable} />
        <select
          defaultValue=""
          onMouseDown={saveSelection}
          onFocus={saveSelection}
          onChange={(event) => {
            insertStudyBlock(event.target.value);
            event.target.value = "";
          }}
          className="h-9 rounded-lg border border-slate-900/10 bg-white px-3 text-sm font-black text-slate-700 shadow-sm outline-none"
        >
          <option value="" disabled>Bloques</option>
          <option value="definicion">Definicion</option>
          <option value="idea">Idea clave</option>
          <option value="algoritmo">Algoritmo / Pseudocodigo</option>
          <option value="complejidad">Complejidad</option>
          <option value="recurrencia">Caso base / Recurrencia</option>
          <option value="ejemplo">Ejemplo</option>
          <option value="error">Error tipico</option>
          <option value="pregunta">Pregunta de examen</option>
          <option value="duda">Duda</option>
        </select>
        <select
          defaultValue=""
          onMouseDown={saveSelection}
          onFocus={saveSelection}
          onChange={(event) => {
            insertCodeBlock(event.target.value);
            event.target.value = "";
          }}
          className="h-9 rounded-lg border border-slate-900/10 bg-[#172033] px-3 text-sm font-black text-white shadow-sm outline-none"
        >
          <option value="" disabled>Insertar codigo</option>
          <option value="cpp">C++</option>
          <option value="javascript">JavaScript</option>
          <option value="htmlcss">HTML / CSS</option>
          <option value="python">Python</option>
          <option value="php">PHP</option>
          <option value="pseudocode">Pseudocodigo</option>
          <option value="text">Texto plano</option>
        </select>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={createQuestionFromSelection} className="h-9 rounded-lg bg-[#dcebdc] px-3 text-sm font-black text-[#1f5d55] shadow-sm hover:bg-[#cde2cd]">
          Crear pregunta
        </button>
        <button
          type="button"
          onClick={() => runCommand("removeFormat")}
          className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100"
        >
          Limpiar
        </button>
        <EditorTool icon={fullscreen ? Minimize2 : Maximize2} label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} onClick={() => setFullscreen((value) => !value)} />
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={addInlineImage} />
      </div>
      <div ref={editorFrameRef} className={`relative bg-[#f3efe6] px-3 pb-5 pt-24 md:px-8 ${fullscreen ? "min-h-screen xl:pt-28" : ""}`}>
        {imageDropIndicator && (
          <div
            className="pointer-events-none absolute z-20 flex items-center gap-2"
            style={{ left: imageDropIndicator.left, top: imageDropIndicator.top, width: imageDropIndicator.width }}
          >
            <span className="h-3 w-3 rounded-full bg-[#2f6f73] shadow-sm" />
            <span className="h-1 flex-1 rounded-full bg-[#2f6f73] shadow-sm" />
            <span className="rounded-full bg-[#172033] px-2 py-1 text-[11px] font-black uppercase text-white">
              {imageDropIndicator.position === "before" ? "Encima" : "Debajo"} · {imageDropIndicator.align === "left" ? "Izquierda" : imageDropIndicator.align === "right" ? "Derecha" : "Centro"}
            </span>
          </div>
        )}
        {selectedImage && imageTools && (
          <div
            className="absolute z-10 flex flex-wrap items-center gap-2 rounded-lg border border-slate-900/10 bg-white/95 p-2 shadow-soft backdrop-blur"
            style={{ left: imageTools.left, top: imageTools.top, maxWidth: "calc(100% - 24px)" }}
          >
            <span className="text-xs font-black uppercase text-slate-500">Imagen</span>
            <input
              type="range"
              min="20"
              max="100"
              value={imageWidth}
              onChange={(event) => resizeSelectedImage(Number(event.target.value))}
              className="w-28"
            />
            <span className="w-9 text-xs font-bold text-slate-500">{imageWidth}%</span>
            <EditorTool icon={AlignLeft} label="Izquierda" onClick={() => alignSelectedImage("left")} />
            <EditorTool icon={AlignCenter} label="Centro" onClick={() => alignSelectedImage("center")} />
            <EditorTool icon={AlignRight} label="Derecha" onClick={() => alignSelectedImage("right")} />
            <button type="button" onClick={addImageCaption} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black">Pie</button>
            <EditorTool icon={Trash2} label="Borrar imagen" onClick={deleteSelectedImage} />
          </div>
        )}
        {selectedBlock && blockTools && (
          <div
            className="absolute z-10 flex flex-wrap items-center gap-2 rounded-lg border border-slate-900/10 bg-white/95 p-2 shadow-soft backdrop-blur"
            style={{ left: blockTools.left, top: blockTools.top, maxWidth: "calc(100% - 24px)" }}
          >
            <span className="text-xs font-black uppercase text-slate-500">Bloque</span>
            <button type="button" onClick={() => resizeSelectedBlock("small")} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black hover:bg-slate-200">Pequeño</button>
            <button type="button" onClick={() => resizeSelectedBlock("normal")} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black hover:bg-slate-200">Normal</button>
            <button type="button" onClick={() => resizeSelectedBlock("large")} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black hover:bg-slate-200">Grande</button>
            <EditorTool icon={Trash2} label="Eliminar bloque" onClick={deleteSelectedBlock} />
          </div>
        )}
        {selectedTable && tableTools && (
          <div
            className="absolute z-10 flex flex-wrap items-center gap-2 rounded-lg border border-slate-900/10 bg-white/95 p-2 shadow-soft backdrop-blur"
            style={{ left: tableTools.left, top: tableTools.top, maxWidth: "calc(100% - 24px)" }}
          >
            <span className="text-xs font-black uppercase text-slate-500">Tabla</span>
            <button type="button" onClick={addTableRow} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black hover:bg-slate-200">+ Fila</button>
            <button type="button" onClick={removeTableRow} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black hover:bg-slate-200">- Fila</button>
            <button type="button" onClick={addTableColumn} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black hover:bg-slate-200">+ Columna</button>
            <button type="button" onClick={removeTableColumn} className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-black hover:bg-slate-200">- Columna</button>
            <EditorTool icon={Trash2} label="Eliminar tabla" onClick={deleteSelectedTable} />
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            saveSelection();
            saveDocument();
          }}
          onClick={handleEditorClick}
          onFocus={handleEditorFocus}
          onBlur={handleEditorBlur}
          onKeyDown={handleEditorKeyDown}
          onPaste={handlePaste}
          onDragStart={handleImageDragStart}
          onDragOver={handleImageDragOver}
          onDrop={handleImageDrop}
          onDragEnd={handleImageDragEnd}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onScroll={() => {
            if (selectedImage) updateImageToolsPosition(selectedImage);
            if (selectedBlock) updateBlockToolsPosition(selectedBlock);
            if (selectedTable) updateTableToolsPosition(selectedTable);
          }}
          className={`study-document mx-auto rounded bg-white text-slate-900 shadow-soft outline-none ${fullscreen ? "min-h-[calc(100vh-132px)] w-full max-w-[1120px] px-8 py-9 md:px-16 md:py-14" : "min-h-[920px] w-full max-w-none px-8 py-9 md:px-16 md:py-14"}`}
        />
      </div>
    </section>
  );
}

function SubjectQAPage({ subject, openModal, updateData, setView }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todas");
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const questions = subject.qa || [];
  const filtered = questions.filter((item) => {
    const matchesSearch = `${item.question} ${item.answer}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "todas" || item.status === filter;
    return matchesSearch && matchesFilter;
  });
  const reviewQuestion = questions[reviewIndex % Math.max(questions.length, 1)];

  const updateQuestionStatus = (questionId, status) => {
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id);
      const question = target.qa?.find((item) => item.id === questionId);
      if (question) question.status = status;
      return draft;
    });
  };

  const deleteQuestion = (questionId) => {
    updateData((draft) => {
      const target = draft.subjects.find((item) => item.id === subject.id);
      target.qa = (target.qa || []).filter((item) => item.id !== questionId);
      return draft;
    });
  };

  const answerReview = (status) => {
    if (!reviewQuestion) return;
    updateQuestionStatus(reviewQuestion.id, status);
    setShowAnswer(false);
    setReviewIndex((index) => (index + 1) % Math.max(questions.length, 1));
  };

  return (
    <div className="space-y-5">
      <button onClick={() => setView({ page: "subject", subjectId: subject.id })} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900">
        <ChevronLeft size={18} /> {subject.name}
      </button>
      <section className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-black uppercase tracking-[0.18em] text-slate-400">{subject.name}</p>
            <h1 className="mt-2 text-4xl font-black">Preguntas y respuestas</h1>
            <p className="mt-2 text-slate-600">Banco de preguntas de teoría de la asignatura.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => exportSubjectQuestionsToPdf(subject)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-black text-[#172033] ring-1 ring-slate-900/10 hover:bg-slate-50">
              <FileText size={18} /> Exportar preguntas a PDF
            </button>
            <button onClick={() => setReviewMode(!reviewMode)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#dcebdc] px-4 text-sm font-black text-[#1f5d55]">
              <HelpCircle size={18} /> Modo repaso
            </button>
            <button onClick={() => openModal({ type: "qa", subjectId: subject.id })} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white">
              <Plus size={18} /> Añadir pregunta
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px]">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="input" placeholder="Buscar preguntas" />
          <select value={filter} onChange={(event) => setFilter(event.target.value)} className="input">
            <option value="todas">Todas</option>
            <option value="pendiente">Pendiente</option>
            <option value="repasando">Repasando</option>
            <option value="dominada">Dominada</option>
          </select>
        </div>
      </section>

      {reviewMode ? (
        <section className="mx-auto max-w-3xl rounded-lg border border-slate-900/10 bg-white p-8 text-center shadow-soft">
          {!reviewQuestion ? (
            <p className="font-bold text-slate-500">Aún no hay preguntas para repasar.</p>
          ) : (
            <>
              <Badge tone={reviewQuestion.status === "dominada" ? "cool" : "soft"}>{reviewQuestion.status}</Badge>
              <h2 className="mt-5 text-3xl font-black text-[#1f5d55]">{reviewQuestion.question}</h2>
              {showAnswer ? (
                <>
                  <p className="mt-6 rounded-lg bg-slate-50 p-5 text-left text-lg text-slate-700">{reviewQuestion.answer}</p>
                  <div className="mt-6 grid gap-2 md:grid-cols-3">
                    <button onClick={() => answerReview("pendiente")} className="rounded-lg bg-slate-100 px-4 py-3 font-black">No me la sé</button>
                    <button onClick={() => answerReview("repasando")} className="rounded-lg bg-yellow-100 px-4 py-3 font-black text-yellow-800">Más o menos</button>
                    <button onClick={() => answerReview("dominada")} className="rounded-lg bg-green-100 px-4 py-3 font-black text-green-700">Me la sé</button>
                  </div>
                </>
              ) : (
                <button onClick={() => setShowAnswer(true)} className="mt-8 rounded-lg bg-[#172033] px-5 py-3 font-black text-white">Ver respuesta</button>
              )}
            </>
          )}
        </section>
      ) : (
        <div className="grid gap-4">
          {filtered.length === 0 && <div className="rounded-lg bg-white p-6 text-center font-bold text-slate-500">No hay preguntas con ese filtro.</div>}
          {filtered.map((item) => (
            <QACard
              key={item.id}
              item={item}
              onEdit={() => openModal({ type: "qa", subjectId: subject.id, item })}
              onDelete={() => deleteQuestion(item.id)}
              onDominated={() => updateQuestionStatus(item.id, "dominada")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QACard({ item, onEdit, onDelete, onDominated }) {
  const tone = qaTone(item.status);
  return (
    <article className="rounded-lg border border-slate-900/10 bg-white p-5 shadow-sm" style={{ borderLeft: `7px solid ${tone.color}` }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className={`rounded px-2 py-1 text-xs font-black uppercase ${tone.badge}`}>{item.status}</span>
          <h2 className="mt-3 text-2xl font-black text-[#1f5d55]">{item.question}</h2>
        </div>
        <div className="flex gap-2">
          <IconButton icon={Pencil} label="Editar" onClick={onEdit} />
          <IconButton icon={Trash2} label="Eliminar" onClick={onDelete} />
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-slate-700">{item.answer}</p>
      {item.status !== "dominada" && (
        <button onClick={onDominated} className="mt-4 rounded-lg bg-green-100 px-3 py-2 text-sm font-black text-green-700">
          Marcar como dominada
        </button>
      )}
    </article>
  );
}

function EditorTool({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-lg bg-white text-slate-700 shadow-sm hover:bg-slate-100"
    >
      <Icon size={17} />
    </button>
  );
}

function CalendarPage({ data, openModal, updateData }) {
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: startOffset + total }, (_, index) => (index < startOffset ? null : index - startOffset + 1));
  const monthLabel = visibleMonth.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  const moveMonth = (offset) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-black">Calendario mensual</h1>
          <p className="mt-1 text-slate-600 capitalize">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton icon={ChevronLeft} label="Mes anterior" onClick={() => moveMonth(-1)} />
          <button onClick={() => setVisibleMonth(new Date())} className="h-11 rounded-lg bg-white px-4 text-sm font-black shadow-sm">Hoy</button>
          <IconButton icon={ChevronRight} label="Mes siguiente" onClick={() => moveMonth(1)} />
          <button onClick={() => openModal({ type: "event", date: todayIso() })} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white">
            <Plus size={18} /> Crear
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:hidden">
        {Array.from({ length: total }, (_, index) => index + 1).map((day) => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const events = data.events.filter((event) => event.date === date);
          const weekday = new Date(year, month, day).toLocaleDateString("es-ES", { weekday: "short" });
          return (
            <button
              key={date}
              type="button"
              onClick={() => openModal({ type: "event", date })}
              className="rounded-lg border border-slate-900/10 bg-white p-4 text-left shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{weekday}</p>
                  <span className={`mt-1 inline-grid h-10 w-10 place-items-center rounded-lg text-lg font-black ${date === todayIso() ? "bg-[#172033] text-white" : "bg-slate-100 text-slate-900"}`}>
                    {day}
                  </span>
                </div>
                <span className="rounded-lg bg-[#dcebdc] px-3 py-1 text-xs font-black text-[#1f5d55]">
                  {events.length ? `${events.length} evento${events.length > 1 ? "s" : ""}` : "Crear"}
                </span>
              </div>
              {events.length > 0 && (
                <div className="mt-3 space-y-2">
                  {events.map((event) => (
                    <span
                      key={event.id}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        openModal({ type: "event", item: event });
                      }}
                      className="block rounded bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700"
                    >
                      {event.start ? `${event.start} · ` : ""}{event.title}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="hidden grid-cols-7 gap-2 md:grid">
        {days.map((day) => (
          <div key={day} className="text-center text-xs font-black uppercase text-slate-400">{day.slice(0, 3)}</div>
        ))}
        {cells.map((day, index) => {
          const date = day ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
          const events = data.events.filter((event) => event.date === date);
          return (
            <button
              key={index}
              type="button"
              disabled={!day}
              aria-label={day ? `Crear evento el ${date}` : "Día vacío"}
              onClick={() => day && openModal({ type: "event", date })}
              className={`min-h-32 rounded-lg border border-slate-900/10 bg-white p-2 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${!day ? "opacity-0" : ""}`}
            >
              <span className={`inline-grid h-8 w-8 place-items-center rounded-lg text-sm font-black ${date === todayIso() ? "bg-[#172033] text-white" : ""}`}>{day}</span>
              <div className="mt-2 space-y-1">
                {events.map((event) => (
                  <span
                    key={event.id}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      openModal({ type: "event", item: event });
                    }}
                    className="block w-full rounded bg-[#dcebdc] px-2 py-1 text-xs font-bold text-[#1f5d55]"
                  >
                    {event.start ? `${event.start} · ` : ""}{event.title}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SchedulePage({ data, openModal, updateData }) {
  return (
    <div className="space-y-5">
      <PageTitle title="Horario semanal" subtitle="Bloques editables para planificar sesiones de estudio." action={() => openModal({ type: "schedule" })} />
      <ScheduleGrid blocks={data.scheduleBlocks} subjects={data.subjects} openModal={openModal} />
    </div>
  );
}

function TasksPage({ data, openModal, updateData }) {
  return (
    <div className="space-y-5">
      <PageTitle title="Tareas" subtitle="Pendientes, entregas y microacciones." action={() => openModal({ type: "task" })} />
      <Panel title="Todas las tareas" icon={ListChecks}>
        <TaskList tasks={data.tasks} data={data} updateData={updateData} openModal={openModal} />
      </Panel>
    </div>
  );
}

function ResourcesPage({ data, openModal, updateData }) {
  return (
    <div className="space-y-5">
      <PageTitle title="Recursos generales" subtitle="Enlaces, PDFs, vídeos y materiales transversales." action={() => openModal({ type: "resource" })} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.resources.map((resource) => (
          <ResourceCard key={resource.id} resource={resource} openModal={openModal} updateData={updateData} />
        ))}
      </div>
    </div>
  );
}

function PomodoroPage({ data, pomodoro }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const {
    selectedSubjectId,
    setSelectedSubjectId,
    selectedSubject,
    mode,
    durations,
    seconds,
    running,
    notes,
    setNotes,
    history,
    start,
    pause,
    reset,
    finish,
    changeMode,
    updateDuration,
    resetDurations,
    deleteSession,
    clearHistory,
  } = pomodoro;
  const modeMeta = {
    study: { label: "Estudio", icon: BookOpen },
    short: { label: "Descanso corto", icon: Clock3 },
    long: { label: "Descanso largo", icon: AlarmClock },
  };
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  const todayKey = todayIso();
  const todayStudySessions = history.filter((session) => session.mode === "study" && session.createdAt?.startsWith(todayKey));
  const completed = todayStudySessions.length;
  const progress = Math.min(100, Math.round((completed / 8) * 100));
  const totalStudyMinutesToday = todayStudySessions.reduce((sum, session) => sum + (session.duration || 0), 0);
  const monthlyStats = useMemo(() => buildPomodoroMonthStats(history), [history]);

  return (
    <div className="rounded-lg border border-slate-900/10 bg-white p-5 shadow-soft md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-lg bg-[#f4c36b] text-[#172033] shadow-sm"><AlarmClock size={28} /></span>
          <div>
            <h1 className="text-3xl font-black">Pomodoro</h1>
            <p className="text-sm font-semibold text-slate-500">Sesion enfocada</p>
          </div>
        </div>
        <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-900/10 bg-slate-50 px-3 text-sm font-black text-slate-600">
          <Target size={17} /> Modo enfoque
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.72fr_1.35fr_0.8fr]">
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
            <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Asignatura</label>
            <div className="mt-2 flex items-center gap-3">
              <BookOpen size={20} className="text-slate-500" />
              <select value={selectedSubjectId} onChange={(event) => setSelectedSubjectId(event.target.value)} className="min-w-0 flex-1 bg-transparent text-base font-black outline-none">
                {data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </div>
          </section>
          <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 font-black"><Target size={18} className="text-amber-500" /> Objetivo diario</h2>
            <p className="mt-4 text-2xl font-black">{completed} <span className="text-base text-slate-400">/ 8 pomodoros</span></p>
            <div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#f4c36b]" style={{ width: `${progress}%` }} /></div>
            <p className="mt-2 text-sm font-bold text-slate-400">{progress}% completado</p>
          </section>
          <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
            <StatRow label="Pomodoros hoy" value={completed} />
            <StatRow label="Asignatura activa" value={selectedSubject?.name || "Sin asignatura"} />
            <StatRow label="Tiempo estudiado hoy" value={`${totalStudyMinutesToday} min`} />
            <StatRow label="Tiempo actual" value={`${durations[mode]} min`} />
          </section>
          <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => setHistoryOpen(true)} className="flex items-center gap-2 font-black hover:text-[#1f5d55]">
                <Clock3 size={18} /> Historial
              </button>
              {history.length > 0 && (
                <button type="button" onClick={clearHistory} className="text-xs font-black text-red-500 hover:text-red-700">
                  Borrar todo
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-400">Todavia no hay sesiones guardadas.</p>
            ) : (
              <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                {history.slice(0, 12).map((session) => (
                  <div key={session.id} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${session.mode === "study" ? "bg-emerald-500" : "bg-amber-500"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-[#172033]">{session.subjectName}</p>
                      <p className="text-xs font-bold text-slate-500">{session.modeLabel} · {session.duration} min</p>
                      <p className="text-xs font-semibold text-slate-400">{new Date(session.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                      {session.notes && <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{session.notes}</p>}
                    </div>
                    <button type="button" onClick={() => deleteSession(session.id)} title="Borrar sesion" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-red-500 shadow-sm hover:bg-red-50">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-slate-900/10 bg-white p-5 text-center shadow-sm">
            <div className="grid gap-2 rounded-lg border border-slate-900/10 p-2 sm:grid-cols-3">
              {Object.entries(modeMeta).map(([key, item]) => {
                const Icon = item.icon;
                const active = mode === key;
                return (
                  <button key={key} type="button" onClick={() => changeMode(key)} className={`inline-flex h-12 items-center justify-center gap-2 rounded-lg text-sm font-black transition ${active ? "bg-amber-50 text-[#172033] ring-1 ring-amber-300" : "text-slate-500 hover:bg-slate-50"}`}>
                    <Icon size={18} /> {item.label}
                  </button>
                );
              })}
            </div>
            <div className="my-12 text-7xl font-black tracking-tight text-[#10182b] tabular-nums md:text-8xl">{mins}:{secs}</div>
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600">
              <Target size={17} /> {modeMeta[mode].label}
            </span>
            <div className="mx-auto mt-4 max-w-sm rounded-lg bg-slate-50 p-4 text-sm font-bold italic text-slate-500">
              "La concentracion es la raiz de todas las capacidades del ser humano."
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-4">
              <button onClick={start} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#172033] text-sm font-black text-white"><Play size={18} /> Iniciar</button>
              <button onClick={pause} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-black text-slate-700"><Pause size={18} /> Pausar</button>
              <button onClick={reset} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-black text-slate-700"><RotateCcw size={18} /> Reiniciar</button>
              <button onClick={finish} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 text-sm font-black text-red-600"><Square size={16} /> Finalizar</button>
            </div>
          </section>
          <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-black">Configuracion de tiempos</h2>
              <button onClick={resetDurations} className="text-sm font-black text-slate-400">Restablecer</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <DurationControl label="Estudio" value={durations.study} onMinus={() => updateDuration("study", -1)} onPlus={() => updateDuration("study", 1)} />
              <DurationControl label="Descanso corto" value={durations.short} onMinus={() => updateDuration("short", -1)} onPlus={() => updateDuration("short", 1)} />
              <DurationControl label="Descanso largo" value={durations.long} onMinus={() => updateDuration("long", -1)} onPlus={() => updateDuration("long", 1)} />
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
          <h2 className="font-black">Notas rapidas</h2>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value.slice(0, 500))} className="mt-4 min-h-[260px] w-full rounded-lg border border-slate-900/10 bg-slate-50 p-3 text-sm font-semibold outline-none focus:ring-4 focus:ring-[#2f6f73]/15" placeholder="Escribe tus ideas, dudas o apuntes rapidos aqui..." />
          <p className="mt-2 text-sm font-bold text-slate-400">{notes.length} / 500 caracteres</p>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
            <p className="font-black">Consejo</p>
            <p className="mt-1 font-semibold">Escribe ideas clave durante la sesion para repasarlas despues.</p>
          </div>
        </section>
      </div>
      {historyOpen && (
        <PomodoroHistoryModal
          history={history}
          stats={monthlyStats}
          onClose={() => setHistoryOpen(false)}
          onDelete={deleteSession}
          onClear={clearHistory}
        />
      )}
    </div>
  );
}

function FloatingPomodoro({ pomodoro, setView }) {
  const fullSeconds = pomodoro.durations[pomodoro.mode] * 60;
  const isActive = pomodoro.running || pomodoro.completionPrompt || pomodoro.seconds !== fullSeconds;
  if (!isActive) return null;
  const mins = String(Math.floor(pomodoro.seconds / 60)).padStart(2, "0");
  const secs = String(pomodoro.seconds % 60).padStart(2, "0");
  const modeLabel = pomodoro.mode === "study" ? "Estudio" : pomodoro.mode === "short" ? "Descanso corto" : "Descanso largo";

  return (
    <aside className="fixed bottom-24 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-white/70 bg-white/95 p-4 shadow-2xl backdrop-blur md:bottom-5">
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${pomodoro.mode === "study" ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"}`}>
          {pomodoro.mode === "study" ? <Target size={22} /> : <Clock3 size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-black text-[#172033]">{pomodoro.running ? "Pomodoro activo" : "Pomodoro pausado"}</p>
            <p className="text-xl font-black tabular-nums text-[#10182b]">{mins}:{secs}</p>
          </div>
          <p className="mt-1 truncate text-xs font-bold text-slate-500">{modeLabel} - {pomodoro.selectedSubject?.name || "Sin asignatura"}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={pomodoro.running ? pomodoro.pause : pomodoro.start}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-[#172033] px-2 text-xs font-black text-white"
            >
              {pomodoro.running ? <Pause size={14} /> : <Play size={14} />} {pomodoro.running ? "Pausar" : "Seguir"}
            </button>
            <button
              type="button"
              onClick={() => setView({ page: "pomodoro" })}
              className="h-9 rounded-lg bg-slate-100 px-2 text-xs font-black text-slate-700"
            >
              Abrir
            </button>
            <button
              type="button"
              onClick={pomodoro.finish}
              className="h-9 rounded-lg border border-red-200 bg-red-50 px-2 text-xs font-black text-red-600"
            >
              Finalizar
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function PomodoroBreakPrompt({ pomodoro }) {
  const subjectName = pomodoro.selectedSubject?.name || "Sin asignatura";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
      <section className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl md:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600">
            <AlarmClock size={28} />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Pomodoro terminado</p>
            <h2 className="mt-1 text-2xl font-black text-[#10182b]">Buen bloque de estudio</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Has terminado una sesion de {subjectName}. Elige un descanso y al acabar se iniciara otro pomodoro automaticamente.
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => pomodoro.startBreak("short")}
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left font-black text-emerald-700 hover:bg-emerald-100"
          >
            <span className="block text-sm uppercase tracking-[0.12em] text-emerald-500">Descanso corto</span>
            {pomodoro.durations.short} minutos
          </button>
          <button
            type="button"
            onClick={() => pomodoro.startBreak("long")}
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-left font-black text-amber-700 hover:bg-amber-100"
          >
            <span className="block text-sm uppercase tracking-[0.12em] text-amber-500">Descanso largo</span>
            {pomodoro.durations.long} minutos
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              pomodoro.setCompletionPrompt(null);
              pomodoro.reset();
            }}
            className="rounded-lg bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-200"
          >
            Parar ciclo
          </button>
        </div>
      </section>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-sm font-bold text-slate-500">{label}</span>
      <span className="max-w-[52%] truncate text-right text-sm font-black text-[#172033]">{value}</span>
    </div>
  );
}

function buildPomodoroMonthStats(history) {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { key, day, study: 0, breaks: 0, total: 0, sessions: 0 };
  });
  const byKey = Object.fromEntries(days.map((day) => [day.key, day]));
  history.forEach((session) => {
    if (!session.createdAt) return;
    const date = new Date(session.createdAt);
    if (date.getMonth() !== month || date.getFullYear() !== year) return;
    const key = session.createdAt.slice(0, 10);
    const row = byKey[key];
    if (!row) return;
    const minutes = session.duration || 0;
    if (session.mode === "study") row.study += minutes;
    else row.breaks += minutes;
    row.total += minutes;
    row.sessions += 1;
  });
  const activeDays = days.filter((day) => day.total > 0);
  return {
    monthLabel: now.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
    days,
    rows: activeDays.reverse(),
    maxTotal: Math.max(1, ...days.map((day) => day.total)),
    totalStudy: days.reduce((sum, day) => sum + day.study, 0),
    totalBreaks: days.reduce((sum, day) => sum + day.breaks, 0),
    totalSessions: days.reduce((sum, day) => sum + day.sessions, 0),
    activeDays: activeDays.length,
  };
}

function PomodoroHistoryModal({ history, stats, onClose, onDelete, onClear }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
      <section className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-lg bg-white p-5 shadow-2xl md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Historial de Pomodoro</p>
            <h2 className="mt-1 text-3xl font-black">Resumen de {stats.monthLabel}</h2>
          </div>
          <div className="flex gap-2">
            {history.length > 0 && <button onClick={onClear} className="h-10 rounded-lg bg-red-50 px-3 text-sm font-black text-red-600">Borrar todo</button>}
            <IconButton icon={X} label="Cerrar" onClick={onClose} />
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <HistoryMetric label="Tiempo estudiado" value={`${stats.totalStudy} min`} />
          <HistoryMetric label="Descansos" value={`${stats.totalBreaks} min`} />
          <HistoryMetric label="Sesiones" value={stats.totalSessions} />
          <HistoryMetric label="Dias activos" value={stats.activeDays} />
        </div>

        <div className="mt-5 rounded-lg border border-slate-900/10 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-black">Actividad diaria del mes</h3>
            <div className="flex gap-3 text-xs font-black text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#1f5d55]" /> Estudio</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#f4c36b]" /> Descanso</span>
            </div>
          </div>
          <div className="mt-4 flex h-44 items-end gap-1 overflow-x-auto pb-2">
            {stats.days.map((day) => {
              const studyHeight = Math.max(2, Math.round((day.study / stats.maxTotal) * 100));
              const breakHeight = Math.max(0, Math.round((day.breaks / stats.maxTotal) * 100));
              return (
                <div key={day.key} className="flex min-w-7 flex-col items-center justify-end gap-1">
                  <div className="flex h-32 w-4 flex-col justify-end overflow-hidden rounded-full bg-white shadow-inner" title={`${day.key}: ${day.study} min estudio, ${day.breaks} min descanso`}>
                    {day.breaks > 0 && <span className="block w-full bg-[#f4c36b]" style={{ height: `${breakHeight}%` }} />}
                    {day.study > 0 && <span className="block w-full bg-[#1f5d55]" style={{ height: `${studyHeight}%` }} />}
                  </div>
                  <span className="text-[10px] font-black text-slate-400">{day.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-lg border border-slate-900/10 bg-white p-4">
            <h3 className="font-black">Tabla por dia</h3>
            <div className="mt-3 max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-slate-400">
                  <tr><th className="py-2">Dia</th><th>Estudio</th><th>Descanso</th><th>Sesiones</th></tr>
                </thead>
                <tbody>
                  {stats.rows.length === 0 ? (
                    <tr><td colSpan="4" className="py-6 text-center font-bold text-slate-400">Sin sesiones este mes.</td></tr>
                  ) : stats.rows.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="py-2 font-black">{new Date(`${row.key}T12:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</td>
                      <td className="font-bold text-[#1f5d55]">{row.study} min</td>
                      <td className="font-bold text-amber-600">{row.breaks} min</td>
                      <td className="font-bold text-slate-600">{row.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-slate-900/10 bg-white p-4">
            <h3 className="font-black">Sesiones recientes</h3>
            <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
              {history.slice(0, 20).map((session) => (
                <div key={session.id} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${session.mode === "study" ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black">{session.subjectName}</p>
                    <p className="text-xs font-bold text-slate-500">{session.modeLabel} · {session.duration} min</p>
                    <p className="text-xs font-semibold text-slate-400">{new Date(session.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <button type="button" onClick={() => onDelete(session.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-red-500 shadow-sm hover:bg-red-50">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function HistoryMetric({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-[#172033]">{value}</p>
    </div>
  );
}

function DurationControl({ label, value, onMinus, onPlus }) {
  return (
    <div className="rounded-lg border border-slate-900/10 bg-slate-50 p-3 text-center">
      <p className="text-sm font-black text-slate-600">{label}</p>
      <p className="mt-2 text-3xl font-black text-[#172033]">{value}</p>
      <p className="text-xs font-bold text-slate-400">minutos</p>
      <div className="mt-3 flex justify-center gap-2">
        <button type="button" onClick={onMinus} className="grid h-8 w-8 place-items-center rounded-lg bg-white text-lg font-black shadow-sm">-</button>
        <button type="button" onClick={onPlus} className="grid h-8 w-8 place-items-center rounded-lg bg-white text-lg font-black shadow-sm">+</button>
      </div>
    </div>
  );
}

function EditorModal({ modal, close, data, updateData }) {
  const initial = getInitialForm(modal);
  const [form, setForm] = useState(initial);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    updateData((draft) => saveModal(draft, modal, form));
    close();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-soft scrollbar-thin">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black">{modal.item ? "Editar" : "Crear"} {modalTitle(modal.type)}</h2>
          <IconButton icon={X} label="Cerrar" onClick={close} type="button" />
        </div>
        <FormFields modal={modal} form={form} set={set} data={data} />
        <div className="mt-5 flex justify-end gap-2">
          {modal.item && <DangerDelete modal={modal} updateData={updateData} close={close} />}
          <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white">
            <Save size={18} /> Guardar
          </button>
        </div>
      </form>
    </div>
  );
}

function FormFields({ modal, form, set, data }) {
  const subjects = data.subjects;
  const themes = subjects.find((subject) => subject.id === form.subjectId)?.themes || [];
  const modalSubject = subjects.find((subject) => subject.id === modal.subjectId || subject.id === form.subjectId);
  const themeSectionOptions = getSubjectStudySections(modalSubject);
  const commonTextArea = ["theme", "theme-note", "theme-section", "exercise", "doubt"].includes(modal.type);

  return (
    <div className="grid gap-3">
      {["subject", "theme", "task", "resource", "event", "schedule", "theme-note", "theme-section", "exercise", "doubt", "check", "theme-resource", "quick-note"].includes(modal.type) && (
        <Field label={["doubt"].includes(modal.type) ? "Duda" : modal.type === "check" ? "Elemento" : "Título / nombre"}>
          <input value={form.title || form.name || form.question || form.label || ""} onChange={(event) => set(mainKey(modal.type), event.target.value)} className="input" required />
        </Field>
      )}
      {modal.type === "qa" && (
        <>
          <Field label="Pregunta"><textarea value={form.question} onChange={(e) => set("question", e.target.value)} className="input min-h-24" required /></Field>
          <Field label="Respuesta"><textarea value={form.answer} onChange={(e) => set("answer", e.target.value)} className="input min-h-36" required /></Field>
          <Field label="Estado"><Select value={form.status} onChange={(v) => set("status", v)} options={["pendiente", "repasando", "dominada"]} /></Field>
        </>
      )}
      {modal.type === "subject" && (
        <>
          <Field label="Descripción"><textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="input min-h-24" /></Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Color"><input type="color" value={form.color} onChange={(e) => set("color", e.target.value)} className="h-11 w-full rounded-lg border" /></Field>
            <Field label="Icono">
              <select value={form.icon} onChange={(e) => set("icon", e.target.value)} className="input">
                {Object.keys(iconMap).map((icon) => <option key={icon}>{icon}</option>)}
              </select>
            </Field>
          </div>
        </>
      )}
      {modal.type === "theme" && (
        <>
          <Field label="Descripción"><textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="input min-h-24" /></Field>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Field label="Foto de portada">
              <input value={form.coverImage || ""} onChange={(e) => set("coverImage", e.target.value)} className="input" placeholder="Pega una URL de imagen o sube una foto" />
            </Field>
            <label className="mt-6 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-slate-100 px-4 text-sm font-black text-slate-700 hover:bg-slate-200">
              <Upload size={18} /> Subir
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  set("coverImage", await fileToDataUrl(file));
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {form.coverImage && (
            <div className="h-36 overflow-hidden rounded-lg border border-slate-900/10 bg-slate-100">
              <img src={form.coverImage} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Apartado">
              <select value={form.section || "teoria"} onChange={(event) => set("section", event.target.value)} className="input">
                {themeSectionOptions.map((section) => (
                  <option key={section.id} value={section.id}>{section.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Estado"><Select value={form.status} onChange={(v) => set("status", v)} options={statuses} /></Field>
            <Field label="Prioridad"><Select value={form.priority} onChange={(v) => set("priority", v)} options={priorities} /></Field>
            <Field label="Fecha objetivo"><input type="date" value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} className="input" /></Field>
          </div>
        </>
      )}
      {modal.type === "task" && (
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Asignatura"><Select value={form.subjectId} onChange={(v) => set("subjectId", v)} options={["", ...subjects.map((s) => s.id)]} labels={{ "": "Sin asignatura", ...Object.fromEntries(subjects.map((s) => [s.id, s.name])) }} /></Field>
          <Field label="Tema"><Select value={form.themeId || ""} onChange={(v) => set("themeId", v)} options={["", ...themes.map((t) => t.id)]} labels={{ "": "Sin tema", ...Object.fromEntries(themes.map((t) => [t.id, t.name])) }} /></Field>
          <Field label="Fecha"><input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="input" /></Field>
          <Field label="Prioridad"><Select value={form.priority} onChange={(v) => set("priority", v)} options={priorities} /></Field>
        </div>
      )}
      {modal.type === "resource" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tipo"><Select value={form.type} onChange={(v) => set("type", v)} options={resourceTypes} /></Field>
          <Field label="URL"><input value={form.url} onChange={(e) => set("url", e.target.value)} className="input" /></Field>
        </div>
      )}
      {modal.type === "event" && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Fecha"><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="input" /></Field>
            <Field label="Inicio"><input type="time" value={form.start || ""} onChange={(e) => set("start", e.target.value)} className="input" /></Field>
            <Field label="Fin"><input type="time" value={form.end || ""} onChange={(e) => set("end", e.target.value)} className="input" /></Field>
            <Field label="Asignatura"><Select value={form.subjectId || ""} onChange={(v) => set("subjectId", v)} options={["", ...subjects.map((s) => s.id)]} labels={{ "": "Sin asignatura", ...Object.fromEntries(subjects.map((s) => [s.id, s.name])) }} /></Field>
          </div>
          <Field label="Texto / descripción"><textarea value={form.description || ""} onChange={(e) => set("description", e.target.value)} className="input min-h-28" /></Field>
        </>
      )}
      {modal.type === "schedule" && (
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Día"><Select value={form.day} onChange={(v) => set("day", v)} options={days} /></Field>
          <Field label="Inicio"><input type="time" value={form.start} onChange={(e) => set("start", e.target.value)} className="input" /></Field>
          <Field label="Fin"><input type="time" value={form.end} onChange={(e) => set("end", e.target.value)} className="input" /></Field>
          <Field label="Asignatura"><Select value={form.subjectId || ""} onChange={(v) => set("subjectId", v)} options={["", ...subjects.map((s) => s.id)]} labels={{ "": "Libre", ...Object.fromEntries(subjects.map((s) => [s.id, s.name])) }} /></Field>
        </div>
      )}
      {commonTextArea && modal.type !== "theme" && modal.type !== "doubt" && (
        <Field label="Contenido"><textarea value={form.body || form.content || ""} onChange={(e) => set(bodyKey(modal.type), e.target.value)} className="input min-h-28" /></Field>
      )}
      {modal.type === "theme-resource" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tipo"><Select value={form.kind} onChange={(v) => set("kind", v)} options={["link", "video", "recurso"]} /></Field>
          <Field label="URL"><input value={form.url} onChange={(e) => set("url", e.target.value)} className="input" /></Field>
        </div>
      )}
      {modal.type === "quick-note" && (
        <>
          <Field label="Asignatura"><Select value={form.subjectId} onChange={(v) => set("subjectId", v)} options={subjects.map((s) => s.id)} labels={Object.fromEntries(subjects.map((s) => [s.id, s.name]))} /></Field>
          <Field label="Contenido"><textarea value={form.body} onChange={(e) => set("body", e.target.value)} className="input min-h-28" /></Field>
        </>
      )}
    </div>
  );
}

function saveModal(draft, modal, form) {
  const upsert = (list, item) => {
    const index = list.findIndex((entry) => entry.id === item.id);
    if (index >= 0) list[index] = item;
    else list.push(item);
  };
  if (modal.type === "subject") upsert(draft.subjects, { ...form, id: modal.item?.id || createId("subject"), themes: modal.item?.themes || [], qa: modal.item?.qa || [], studySections: modal.item?.studySections || form.studySections, questionsLabel: modal.item?.questionsLabel || form.questionsLabel });
  if (modal.type === "theme") {
    const subject = draft.subjects.find((entry) => entry.id === modal.subjectId);
    upsert(subject.themes, {
      ...form,
      id: modal.item?.id || createId("theme"),
      subjectId: modal.subjectId,
      section: form.section || modal.item?.section || modal.section || "teoria",
      notes: modal.item?.notes || [],
      sections: modal.item?.sections || [],
      media: modal.item?.media || [],
      links: modal.item?.links || [],
      videos: modal.item?.videos || [],
      exercises: modal.item?.exercises || [],
      doubts: modal.item?.doubts || [],
      checklist: modal.item?.checklist || [],
      resources: modal.item?.resources || [],
      documentHtml: modal.item?.documentHtml || emptyThemeDocument(form.name),
      coverImage: form.coverImage || modal.item?.coverImage || "",
    });
  }
  if (modal.type === "task") upsert(draft.tasks, { ...form, id: modal.item?.id || createId("task"), themeId: form.themeId || null, subjectId: form.subjectId || null, done: modal.item?.done || false });
  if (modal.type === "resource") upsert(draft.resources, { ...form, id: modal.item?.id || createId("resource") });
  if (modal.type === "event") upsert(draft.events, { ...form, id: modal.item?.id || createId("event"), subjectId: form.subjectId || null });
  if (modal.type === "schedule") upsert(draft.scheduleBlocks, { ...form, id: modal.item?.id || createId("block"), subjectId: form.subjectId || null });
  if (modal.type === "qa") saveSubjectQuestion(draft, modal, form);
  if (["theme-note", "theme-section", "exercise", "doubt", "check", "theme-resource", "quick-note"].includes(modal.type)) saveThemeContent(draft, modal, form);
  return draft;
}

function saveSubjectQuestion(draft, modal, form) {
  const subject = draft.subjects.find((item) => item.id === modal.subjectId);
  if (!subject) return;
  if (!subject.qa) subject.qa = [];
  const item = { id: modal.item?.id || createId("qa"), question: form.question, answer: form.answer, status: form.status || "pendiente" };
  const index = subject.qa.findIndex((entry) => entry.id === item.id);
  if (index >= 0) subject.qa[index] = item;
  else subject.qa.push(item);
}

function saveThemeContent(draft, modal, form) {
  const target = modal.type === "quick-note"
    ? draft.subjects.find((subject) => subject.id === form.subjectId)?.themes[0]
    : findTheme(draft, modal.subjectId, modal.themeId);
  if (!target) return;
  const upsert = (key, item) => {
    if (!target[key]) target[key] = [];
    const list = target[key];
    const index = list.findIndex((entry) => entry.id === item.id);
    if (index >= 0) list[index] = item;
    else list.push(item);
  };
  if (modal.type === "theme-note" || modal.type === "quick-note") {
    upsert("notes", { id: modal.item?.id || createId("note"), title: form.title, body: form.body, createdAt: modal.item?.createdAt || new Date().toISOString() });
    target.documentHtml = `${target.documentHtml || buildThemeDocument(target)}<h2>${escapeHtml(form.title)}</h2><p>${escapeHtml(form.body)}</p>`;
  }
  if (modal.type === "theme-section") upsert("sections", { id: modal.item?.id || createId("section"), title: form.title, content: form.content });
  if (modal.type === "exercise") upsert("exercises", { id: modal.item?.id || createId("exercise"), title: form.title, body: form.body, solved: modal.item?.solved || false });
  if (modal.type === "doubt") upsert("doubts", { id: modal.item?.id || createId("doubt"), question: form.question, resolved: modal.item?.resolved || false });
  if (modal.type === "check") upsert("checklist", { id: modal.item?.id || createId("check"), label: form.label, done: modal.item?.done || false });
  if (modal.type === "theme-resource") {
    const key = form.kind === "video" ? "videos" : form.kind === "link" ? "links" : "resources";
    upsert(key, { id: modal.item?.id || createId("resource"), title: form.title, url: form.url, type: form.kind });
  }
}

function DangerDelete({ modal, updateData, close }) {
  const remove = () => {
    updateData((draft) => {
      if (modal.type === "subject") draft.subjects = draft.subjects.filter((item) => item.id !== modal.item.id);
      if (modal.type === "theme") {
        const subject = draft.subjects.find((item) => item.id === modal.subjectId);
        subject.themes = subject.themes.filter((item) => item.id !== modal.item.id);
      }
      if (modal.type === "task") draft.tasks = draft.tasks.filter((item) => item.id !== modal.item.id);
      if (modal.type === "resource") draft.resources = draft.resources.filter((item) => item.id !== modal.item.id);
      if (modal.type === "event") draft.events = draft.events.filter((item) => item.id !== modal.item.id);
      if (modal.type === "schedule") draft.scheduleBlocks = draft.scheduleBlocks.filter((item) => item.id !== modal.item.id);
      if (modal.type === "qa") {
        const subject = draft.subjects.find((item) => item.id === modal.subjectId);
        if (subject) subject.qa = (subject.qa || []).filter((item) => item.id !== modal.item.id);
      }
      if (["theme-note", "theme-section", "exercise", "doubt", "check", "theme-resource"].includes(modal.type)) {
        const target = findTheme(draft, modal.subjectId, modal.themeId);
        const key = contentListKey(modal);
        if (target && key) target[key] = target[key].filter((item) => item.id !== modal.item.id);
      }
      return draft;
    });
    close();
  };
  return <button type="button" onClick={remove} className="inline-flex h-11 items-center gap-2 rounded-lg bg-red-50 px-4 text-sm font-black text-red-700"><Trash2 size={18} /> Borrar</button>;
}

function getInitialForm(modal) {
  if (modal.item) {
    return {
      ...modal.item,
      section: modal.item.section || "teoria",
      status: modal.type === "theme" ? normalizeStudyState(modal.item.status) : modal.item.status,
      title: modal.item.title || modal.item.name || modal.item.question || modal.item.label || "",
    };
  }
  const base = { title: "", name: "", description: "", url: "", body: "", content: "", question: "", label: "" };
  if (modal.type === "subject") return { ...base, name: "", color: "#2f6f73", icon: "network", targetDate: todayIso() };
  if (modal.type === "theme") return { ...base, name: "", section: modal.section || "teoria", status: "pendiente", priority: "media", targetDate: todayIso(), coverImage: "" };
  if (modal.type === "task") return { ...base, subjectId: "", themeId: "", dueDate: todayIso(), priority: "media" };
  if (modal.type === "resource") return { ...base, type: "link" };
  if (modal.type === "event") return { ...base, date: modal.date || todayIso(), subjectId: "", start: "", end: "", description: "" };
  if (modal.type === "schedule") return { ...base, day: "lunes", start: "09:00", end: "10:00", subjectId: "" };
  if (modal.type === "theme-resource") return { ...base, kind: "link" };
  if (modal.type === "quick-note") return { ...base, subjectId: "" };
  if (modal.type === "qa") return { question: "", answer: "", status: "pendiente" };
  return base;
}

function contentListKey(modal) {
  if (modal.type === "theme-note") return "notes";
  if (modal.type === "theme-section") return "sections";
  if (modal.type === "exercise") return "exercises";
  if (modal.type === "doubt") return "doubts";
  if (modal.type === "check") return "checklist";
  if (modal.type === "qa") return "qa";
  if (modal.type === "theme-resource") {
    if (modal.item?.type === "video") return "videos";
    if (modal.item?.type === "link") return "links";
    return "resources";
  }
  return null;
}

function SubjectCard({ subject, setView, openModal, updateData, large = false }) {
  return (
    <article className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <ColorIcon subject={subject} />
        <div className="flex gap-1">
          <IconButton icon={Pencil} label="Editar" onClick={() => openModal({ type: "subject", item: subject })} />
          <IconButton icon={Plus} label="Añadir tema" onClick={() => openModal({ type: "theme", subjectId: subject.id })} />
        </div>
      </div>
      <h3 className="mt-4 text-xl font-black">{subject.name}</h3>
      <p className={`mt-2 text-sm text-slate-600 ${large ? "" : "line-clamp-2"}`}>{subject.description}</p>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-500">{subject.themes.length} temas</span>
        <button onClick={() => setView({ page: "subject", subjectId: subject.id })} className="rounded-lg bg-[#172033] px-3 py-2 text-sm font-black text-white">
          Entrar
        </button>
      </div>
    </article>
  );
}

function ThemeCard({ theme, subject, setView, openModal, onSectionChange }) {
  const fallback = getThemeCover(theme, subject);
  return (
    <article className="group overflow-hidden rounded-lg border border-slate-900/10 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-soft">
      <div className="relative h-40 overflow-hidden" style={!theme.coverImage ? { background: fallback.background } : undefined}>
        {theme.coverImage && <img src={theme.coverImage} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
        {!theme.coverImage && (
          <div className="absolute inset-0 p-5 text-white">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-white/18 backdrop-blur"><BookOpen size={24} /></div>
            <div className="absolute bottom-4 left-5 right-5 h-14 rounded-lg border border-white/20 bg-white/12 backdrop-blur" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/10 to-transparent" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <Badge>{theme.status}</Badge>
          <Badge tone={theme.priority === "alta" ? "hot" : "cool"}>{theme.priority}</Badge>
        </div>
        <div className="absolute right-4 top-4">
          <IconButton icon={Pencil} label="Editar" onClick={() => openModal({ type: "theme", subjectId: subject.id, item: theme })} />
        </div>
        <div className="absolute bottom-4 left-4 right-4 text-white">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-white/70">{subject.name}</p>
          <h3 className="mt-1 text-2xl font-black leading-tight">{theme.name}</h3>
        </div>
      </div>
      <div className="p-4">
        <p className="line-clamp-2 min-h-10 text-sm text-slate-600">{theme.description}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ background: subject.color }} />
            {theme.targetDate}
          </div>
          <button onClick={() => setView({ page: "theme", subjectId: subject.id, themeId: theme.id })} className="rounded-lg bg-[#172033] px-3 py-2 text-sm font-black text-white">
            Abrir
          </button>
        </div>
        {onSectionChange && (
          <select
            value={theme.section || "teoria"}
            onChange={(event) => onSectionChange(theme.id, event.target.value)}
            className="mt-3 w-full rounded-lg border border-slate-900/10 bg-slate-50 px-3 py-2 text-xs font-black uppercase text-slate-500 outline-none"
          >
            {getSubjectStudySections(subject).map((section) => (
              <option key={section.id} value={section.id}>{section.label}</option>
            ))}
          </select>
        )}
      </div>
    </article>
  );
}

function PomodoroCard({ full = false }) {
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSeconds((value) => Math.max(value - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return (
    <div className={`rounded-lg border border-slate-900/10 bg-white p-5 shadow-soft ${full ? "text-center" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-[#f4c36b]"><AlarmClock /></span>
        <div><h2 className="font-black">Pomodoro</h2><p className="text-sm text-slate-500">Sesión enfocada</p></div>
      </div>
      <div className="my-6 text-center text-6xl font-black tabular-nums">{mins}:{secs}</div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setRunning(!running)} className="rounded-lg bg-[#172033] py-2 text-sm font-black text-white">{running ? "Pausa" : "Iniciar"}</button>
        <button onClick={() => { setRunning(false); setSeconds(25 * 60); }} className="rounded-lg bg-slate-100 py-2 text-sm font-black">25</button>
        <button onClick={() => { setRunning(false); setSeconds(5 * 60); }} className="rounded-lg bg-slate-100 py-2 text-sm font-black">5</button>
      </div>
    </div>
  );
}

function TaskList({ tasks, data, updateData, openModal }) {
  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const subject = data.subjects.find((item) => item.id === task.subjectId);
        return (
          <div key={task.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => updateData((draft) => {
                const target = draft.tasks.find((item) => item.id === task.id);
                target.done = !target.done;
                return draft;
              })}
            />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-black ${task.done ? "text-slate-400 line-through" : ""}`}>{task.title}</p>
              <p className="text-xs text-slate-500">{subject?.name || "General"} · {task.dueDate}</p>
            </div>
            <IconButton icon={Pencil} label="Editar" onClick={() => openModal({ type: "task", item: task })} />
          </div>
        );
      })}
    </div>
  );
}

function ScheduleGrid({ blocks, subjects, openModal }) {
  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {days.map((day) => (
        <div key={day} className="rounded-lg border border-slate-900/10 bg-white p-3">
          <h3 className="mb-3 text-sm font-black capitalize">{day}</h3>
          <div className="space-y-2">
            {blocks.filter((block) => block.day === day).sort((a, b) => a.start.localeCompare(b.start)).map((block) => {
              const subject = subjects.find((item) => item.id === block.subjectId);
              return (
                <button key={block.id} onClick={() => openModal({ type: "schedule", item: block })} className="w-full rounded-lg p-3 text-left text-sm font-bold text-white" style={{ background: subject?.color || "#172033" }}>
                  {block.start}-{block.end}<br />{block.title}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniCalendar({ events, subjects }) {
  if (!events.length) return <div className="rounded-lg bg-slate-50 p-4 text-sm font-bold text-slate-500">No hay eventos en el calendario.</div>;
  return <div className="space-y-2">{events.map((event) => <div key={event.id} className="rounded-lg bg-slate-50 p-3 text-sm font-bold">{event.date} · {event.title}</div>)}</div>;
}

function ScheduleMini({ blocks, subjects }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {days.map((day) => {
        const dayBlocks = blocks.filter((block) => block.day === day).sort((a, b) => a.start.localeCompare(b.start));
        return (
          <div key={day} className="rounded-lg border border-slate-900/10 bg-slate-50 p-3">
            <h3 className="text-sm font-black capitalize text-slate-500">{day}</h3>
            <div className="mt-2 space-y-2">
              {dayBlocks.length === 0 && <p className="text-sm font-bold text-slate-400">Libre</p>}
              {dayBlocks.map((block) => {
                const subject = subjects.find((item) => item.id === block.subjectId);
                return (
                  <div key={block.id} className="rounded-lg p-3 text-sm font-bold text-white" style={{ background: subject?.color || "#172033" }}>
                    <span className="block text-xs text-white/70">{block.start}-{block.end}</span>
                    {block.title}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResourceCard({ resource, openModal }) {
  return (
    <article className="rounded-lg border border-slate-900/10 bg-white p-4">
      <Badge>{resource.type}</Badge>
      <h3 className="mt-3 font-black">{resource.title}</h3>
      <p className="mt-2 truncate text-sm text-slate-500">{resource.url || "Sin URL"}</p>
      <button onClick={() => openModal({ type: "resource", item: resource })} className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-black">Editar</button>
    </article>
  );
}

function ThemeSection({ title, icon: Icon, onAdd, children }) {
  return (
    <section className="rounded-lg border border-slate-900/10 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-black"><Icon size={18} /> {title}</h2>
        <IconButton icon={Plus} label="Añadir" onClick={onAdd} />
      </div>
      {children}
    </section>
  );
}

function TextCards({ items, main, body, onEdit }) {
  return <div className="grid gap-2">{items.map((item) => <button key={item.id} onClick={() => onEdit(item)} className="rounded-lg bg-slate-50 p-3 text-left"><p className="font-black">{String(item[main])}</p><p className="mt-1 text-sm text-slate-600">{String(item[body] ?? "")}</p></button>)}</div>;
}

function LinkList({ items }) {
  return <div className="space-y-2">{items.map((item) => <a key={item.id} href={item.url || "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm font-bold"><LinkIcon size={16} /> {item.title}</a>)}</div>;
}

function StoredFileLink({ file, onPreview, onDelete }) {
  const [href, setHref] = useState(file.dataUrl || "");

  useEffect(() => {
    let objectUrl = "";
    if (!file.fileId) return undefined;
    getStoredFile(file.fileId).then((stored) => {
      if (!stored?.blob) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setHref(objectUrl);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.fileId]);

  const isImage = file.type !== "pdf" && (file.mime?.startsWith("image/") || href);

  return (
    <div className="flex gap-3 rounded-lg border border-slate-900/10 bg-white p-2">
      <a href={href || "#"} target="_blank" className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded bg-slate-100 text-xs font-black text-slate-500" rel="noreferrer">
        {isImage && href ? <img src={href} alt={file.name} className="h-full w-full object-cover" /> : "PDF"}
      </a>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black">{file.name}</p>
        <p className="mt-1 text-xs font-bold uppercase text-slate-400">{file.type === "pdf" ? "PDF" : "Imagen"}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={onPreview} className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">Vista</button>
          <a href={href || "#"} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">Abrir</a>
          <button type="button" onClick={onDelete} className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-700">Borrar</button>
        </div>
      </div>
    </div>
  );
}

function FilePreviewModal({ file, close }) {
  const [href, setHref] = useState(file.dataUrl || "");
  useEffect(() => {
    let objectUrl = "";
    if (!file.fileId) return undefined;
    getStoredFile(file.fileId).then((stored) => {
      if (!stored?.blob) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setHref(objectUrl);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.fileId]);
  const isPdf = file.type === "pdf" || file.mime?.includes("pdf");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-soft">
        <div className="flex items-center justify-between gap-3 border-b border-slate-900/10 p-4">
          <div>
            <h2 className="font-black">{file.name}</h2>
            <p className="text-xs font-bold uppercase text-slate-400">{isPdf ? "PDF" : "Imagen"}</p>
          </div>
          <IconButton icon={X} label="Cerrar" onClick={close} />
        </div>
        <div className="max-h-[75vh] overflow-auto bg-slate-50 p-4">
          {isPdf ? (
            <iframe title={file.name} src={href} className="h-[70vh] w-full rounded-lg bg-white" />
          ) : href ? (
            <img src={href} alt={file.name} className="mx-auto max-h-[70vh] rounded-lg object-contain shadow-soft" />
          ) : (
            <p className="p-8 text-center font-bold text-slate-500">Cargando archivo...</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, action, children }) {
  return (
    <section className="rounded-lg border border-slate-900/10 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-black"><Icon size={20} /> {title}</h2>
        {action && <IconButton icon={Plus} label="Crear" onClick={action} />}
      </div>
      {children}
    </section>
  );
}

function PageTitle({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-4xl font-black">{title}</h1><p className="mt-1 text-slate-600">{subtitle}</p></div>
      {action && <button onClick={action} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white"><Plus size={18} /> Crear</button>}
    </div>
  );
}

function ColorIcon({ subject, light = false }) {
  const Icon = iconMap[subject.icon] || BookOpen;
  return <span className={`grid h-11 w-11 place-items-center rounded-lg ${light ? "bg-white/20 text-white" : "text-white"}`} style={{ backgroundColor: light ? undefined : subject.color }}><Icon size={21} /></span>;
}

function Metric({ label, value }) {
  return <div className="rounded-lg bg-white/10 p-4"><p className="text-sm text-white/60">{label}</p><p className="mt-1 text-3xl font-black">{value}</p></div>;
}

function DashboardAction({ icon: Icon, label, tone, onClick }) {
  const toneClass = {
    green: "text-emerald-700 ring-emerald-200/80 hover:bg-emerald-50",
    blue: "text-blue-700 ring-blue-200/80 hover:bg-blue-50",
    purple: "text-violet-700 ring-violet-200/80 hover:bg-violet-50",
  }[tone] || "text-slate-800 ring-slate-200 hover:bg-slate-50";
  return (
    <button onClick={onClick} className={`inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-white/72 px-3 text-sm font-black shadow-sm ring-1 backdrop-blur-[3px] transition ${toneClass}`}>
      <Icon size={21} /> {label}
    </button>
  );
}

function ActionButton({ icon: Icon, label, onClick }) {
  return <button onClick={onClick} className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-black text-slate-900"><Icon size={18} /> {label}</button>;
}

function QuickButton({ icon: Icon, label, onClick }) {
  return <button onClick={onClick} title={label} className="hidden h-11 items-center gap-2 rounded-lg bg-white px-3 text-sm font-black shadow-sm md:inline-flex"><Icon size={18} /><span className="hidden lg:inline">{label}</span></button>;
}

function IconButton({ icon: Icon, label, onClick, type = "button" }) {
  return <button type={type} onClick={onClick} title={label} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"><Icon size={17} /></button>;
}

function Badge({ children, tone = "soft" }) {
  const cls = tone === "hot" ? "bg-[#ffe2d4] text-[#9a3b1f]" : tone === "cool" ? "bg-[#dcebdc] text-[#1f5d55]" : "bg-slate-100 text-slate-600";
  return <span className={`rounded px-2 py-1 text-xs font-black uppercase ${cls}`}>{children}</span>;
}

function Field({ label, children }) {
  return <label className="grid gap-1 text-sm font-bold text-slate-600"><span>{label}</span>{children}</label>;
}

function Select({ value, onChange, options, labels = {} }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="input">{options.map((option) => <option key={option} value={option}>{labels[option] || option}</option>)}</select>;
}

function mainKey(type) {
  if (type === "subject" || type === "theme") return "name";
  if (type === "doubt") return "question";
  if (type === "check") return "label";
  return "title";
}

function bodyKey(type) {
  return type === "theme-section" ? "content" : "body";
}

function modalTitle(type) {
  return ({
    subject: "asignatura",
    theme: "tema",
    task: "tarea",
    resource: "recurso",
    event: "evento",
    schedule: "bloque",
    "theme-note": "apunte",
    "theme-section": "subapartado",
    exercise: "ejercicio",
    doubt: "duda",
    check: "repaso",
    "theme-resource": "recurso del tema",
    "quick-note": "apunte",
    qa: "pregunta",
  })[type] || "elemento";
}

function findTheme(draft, subjectId, themeId) {
  return draft.subjects.find((subject) => subject.id === subjectId)?.themes.find((theme) => theme.id === themeId);
}

function filterItems(items, query, keys) {
  if (!query.trim()) return items;
  const needle = query.toLowerCase();
  return items.filter((item) => keys.some((key) => String(item[key] || "").toLowerCase().includes(needle)));
}

function getThemeCover(theme, subject) {
  const options = [
    `linear-gradient(135deg, ${subject.color}, #172033 58%, #f4c36b)`,
    `radial-gradient(circle at 20% 20%, #f4c36b, transparent 28%), linear-gradient(135deg, ${subject.color}, #6d5bd0)`,
    `linear-gradient(145deg, #172033, ${subject.color}), repeating-linear-gradient(45deg, rgba(255,255,255,.14) 0 8px, transparent 8px 18px)`,
    `radial-gradient(circle at 80% 10%, rgba(255,255,255,.35), transparent 24%), linear-gradient(135deg, ${subject.color}, #c8505b)`,
    `linear-gradient(135deg, #33805f, ${subject.color} 48%, #d8892f)`,
  ];
  const index = Math.abs(String(theme.id || theme.name).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % options.length;
  return { background: options[index] };
}

function enrichTheme(theme, subject, tasks) {
  const studyState = normalizeStudyState(theme.status);
  return {
    ...theme,
    subject,
    studyState,
    studyLabel: studyStateLabels[studyState],
  };
}

const studyStateLabels = {
  nada: "nada estudiado",
  medio: "medio estudiado",
  estudiado: "estudiado",
};

const studyStateOptions = [
  { id: "nada", label: "Nada estudiado", short: "Nada" },
  { id: "medio", label: "Medio estudiado", short: "Medio" },
  { id: "estudiado", label: "Estudiado", short: "Hecho" },
];

function normalizeStudyState(status) {
  if (status === "estudiado" || status === "completado" || status === "dominado") return "estudiado";
  if (status === "medio" || status === "en-curso" || status === "estudiando" || status === "repasando" || status === "bloqueado") return "medio";
  return "nada";
}

function stateTone(state) {
  return {
    nada: { dot: "#94a3b8", soft: "#e2e8f0", badge: "bg-slate-100 text-slate-600" },
    medio: { dot: "#d89b18", soft: "#fef3c7", badge: "bg-yellow-100 text-yellow-800" },
    estudiado: { dot: "#2f8f5b", soft: "#dcfce7", badge: "bg-green-100 text-green-700" },
  }[state] || { dot: "#94a3b8", soft: "#e2e8f0", badge: "bg-slate-100 text-slate-600" };
}

function qaTone(status) {
  return {
    pendiente: { color: "#94a3b8", badge: "bg-slate-100 text-slate-600" },
    repasando: { color: "#d89b18", badge: "bg-yellow-100 text-yellow-800" },
    dominada: { color: "#2f8f5b", badge: "bg-green-100 text-green-700" },
  }[status] || { color: "#94a3b8", badge: "bg-slate-100 text-slate-600" };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function emptyThemeDocument(title = "Apuntes") {
  return `<div class="auto-toc" contenteditable="false"><h2>Índice</h2><p class="toc-empty">Añade títulos y subtítulos para crear el índice.</p></div><h1>${escapeHtml(title)}</h1><p>Empieza a escribir tus apuntes aquí...</p>`;
}

function buildThemeDocument(theme) {
  const blocks = [`<div class="auto-toc" contenteditable="false"><h2>Índice</h2><p class="toc-empty">Añade títulos y subtítulos para crear el índice.</p></div><h1>${escapeHtml(theme.name)}</h1>`];
  if (theme.description) blocks.push(`<p>${escapeHtml(theme.description)}</p>`);
  if (theme.notes?.length) {
    blocks.push("<h2>Apuntes</h2>");
    theme.notes.forEach((note) => blocks.push(`<h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.body)}</p>`));
  }
  if (theme.sections?.length) {
    blocks.push("<h2>Subapartados</h2>");
    theme.sections.forEach((section) => blocks.push(`<h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.content)}</p>`));
  }
  if (theme.exercises?.length) {
    blocks.push("<h2>Ejercicios</h2>");
    theme.exercises.forEach((exercise) => blocks.push(`<h3>${escapeHtml(exercise.title)}</h3><p>${escapeHtml(exercise.body)}</p>`));
  }
  if (theme.doubts?.length) {
    blocks.push("<h2>Dudas</h2>");
    theme.doubts.forEach((doubt) => blocks.push(`<p>${escapeHtml(doubt.question)}</p>`));
  }
  return blocks.join("");
}

function updateDocumentToc(editor) {
  let toc = editor.querySelector(":scope > .auto-toc");
  if (!toc) {
    toc = document.createElement("div");
    toc.className = "auto-toc";
    toc.contentEditable = "false";
    editor.prepend(toc);
  }
  const headings = Array.from(editor.querySelectorAll("h1, h2, h3, h4")).filter((heading) => !toc.contains(heading));
  headings.forEach((heading, index) => {
    if (!heading.id) heading.id = `titulo-${index + 1}-${Date.now().toString(36)}`;
  });
  const items = headings
    .map((heading) => {
      const level = Number(heading.tagName.slice(1));
      const text = escapeHtml(heading.textContent.trim() || "Sin título");
      return `<div class="toc-row toc-level-${level}"><a href="#${heading.id}">${text}</a><button type="button" data-toc-delete="${heading.id}" contenteditable="false" title="Borrar esta seccion">Borrar</button></div>`;
    })
    .join("");
  toc.innerHTML = `<h2>Índice</h2>${items || '<p class="toc-empty">Añade títulos y subtítulos para crear el índice.</p>'}`;
}

function ensureEditableParagraph(editor) {
  if (!editor) return;
  const hasEditableContent = Array.from(editor.childNodes).some((node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.classList.contains("auto-toc")) return false;
    return node.textContent.trim() || node.tagName === "IMG" || node.tagName === "TABLE";
  });
  if (hasEditableContent) return;
  const paragraph = document.createElement("p");
  paragraph.innerHTML = "<br>";
  editor.appendChild(paragraph);
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function normalizeEditableBlocks(editor) {
  if (!editor) return;
  editor.querySelectorAll(".study-block, .study-code-block").forEach((block) => {
    block.dataset.studyBlock = "true";
    if (!block.dataset.blockSize) block.dataset.blockSize = "normal";
    if (!block.classList.contains("study-content-small") && !block.classList.contains("study-content-large")) {
      block.classList.add("study-content-normal");
    }
  });
}

function highlightCodeBlocks(root) {
  root.querySelectorAll(".study-code-content").forEach((code) => highlightCodeElement(code));
}

function unhighlightCodeElement(codeElement) {
  if (!codeElement) return;
  codeElement.textContent = codeElement.innerText.replace(/\n$/, "");
}

function highlightCodeElement(codeElement) {
  if (!codeElement) return;
  const block = codeElement.closest(".study-code-block");
  const language = block?.dataset.codeLanguage || "Texto plano";
  const rawCode = codeElement.innerText.replace(/\n$/, "");
  codeElement.innerHTML = highlightCodeSyntax(rawCode, language);
}

function highlightCodeSyntax(code = "", language = "Texto plano") {
  const keywords = getCodeKeywords(language);
  const tokenRegex = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w$]*(?=\s*\()|\b[A-Za-z_][\w$]*\b|[{}()[\];,.+\-*/%=<>!&|:]+)/g;
  let output = "";
  let lastIndex = 0;
  for (const match of code.matchAll(tokenRegex)) {
    const token = match[0];
    output += escapeHtml(code.slice(lastIndex, match.index));
    const isFunction = /^[A-Za-z_][\w$]*$/.test(token) && /^\s*\(/.test(code.slice(match.index + token.length));
    output += renderCodeToken(token, keywords, isFunction);
    lastIndex = match.index + token.length;
  }
  output += escapeHtml(code.slice(lastIndex));
  return output || "Escribe aqui tu codigo...";
}

function renderCodeToken(token, keywords, isFunction = false) {
  if (/^(\/\/|#|\/\*|<!--)/.test(token)) return `<span class="code-token-comment">${escapeHtml(token)}</span>`;
  if (/^["'`]/.test(token)) return `<span class="code-token-string">${escapeHtml(token)}</span>`;
  if (/^\d/.test(token)) return `<span class="code-token-number">${escapeHtml(token)}</span>`;
  if (/^[{}()[\];,.+\-*/%=<>!&|:]+$/.test(token)) return `<span class="code-token-operator">${escapeHtml(token)}</span>`;
  if (keywords.has(token)) return `<span class="code-token-keyword">${escapeHtml(token)}</span>`;
  if (isFunction) return `<span class="code-token-function">${escapeHtml(token)}</span>`;
  if (/^[A-Za-z_][\w$]*$/.test(token)) return `<span class="code-token-variable">${escapeHtml(token)}</span>`;
  return escapeHtml(token);
}

function getCodeKeywords(language = "") {
  const common = ["if", "else", "for", "while", "do", "switch", "case", "break", "continue", "return", "class", "public", "private", "protected", "static", "const", "new", "try", "catch", "throw", "true", "false", "null", "void"];
  const byLanguage = {
    "C++": ["int", "long", "double", "float", "char", "bool", "string", "vector", "map", "set", "queue", "stack", "auto", "namespace", "using", "include", "define", "template", "typename", "struct"],
    JavaScript: ["let", "var", "const", "function", "async", "await", "import", "export", "from", "default", "extends", "this", "undefined", "typeof"],
    "HTML / CSS": ["html", "head", "body", "div", "span", "section", "article", "header", "footer", "main", "class", "id", "style", "display", "flex", "grid", "color", "background", "margin", "padding"],
    Python: ["def", "lambda", "self", "None", "True", "False", "elif", "in", "is", "not", "and", "or", "import", "from", "as", "with", "yield", "pass"],
    PHP: ["php", "echo", "function", "array", "namespace", "use", "extends", "implements", "public", "private", "protected"],
    Pseudocodigo: ["si", "sino", "para", "mientras", "hacer", "devolver", "funcion", "inicio", "fin", "entonces", "hasta"],
  };
  return new Set([...(byLanguage[language] || []), ...common]);
}

function getDocumentHeadings(editor) {
  return Array.from(editor.querySelectorAll("h1, h2, h3, h4"))
    .filter((heading) => !heading.closest(".auto-toc"))
    .map((heading, index) => {
      if (!heading.id) heading.id = `titulo-${index + 1}-${Date.now().toString(36)}`;
      return {
        id: heading.id,
        text: heading.textContent.trim() || "Sin titulo",
        level: Number(heading.tagName.slice(1)),
      };
    });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function exportThemeToPdf(subject, theme, options = { includeToc: true, includeImages: true }) {
  try {
    await exportThemeVisualPdf(subject, theme, options);
  } catch (error) {
    console.error(error);
    window.alert("No se ha podido exportar el tema a PDF. Revisa si algun bloque o imagen esta dando problemas.");
  }
}

async function exportThemeVisualPdf(subject, theme, options = { includeToc: true, includeImages: true }) {
  const liveDocument = document.querySelector(".study-document");
  const sourceDocument = liveDocument?.cloneNode(true) || document.createElement("div");
  if (!liveDocument) {
    sourceDocument.className = "study-document";
    sourceDocument.innerHTML = theme.documentHtml || buildThemeDocument(theme);
  }

  normalizeEditableBlocks(sourceDocument);
  updateDocumentToc(sourceDocument);
  highlightCodeBlocks(sourceDocument);
  sourceDocument.querySelectorAll(".selected-study-block, .selected-editor-image").forEach((node) => {
    node.classList.remove("selected-study-block", "selected-editor-image");
  });
  sourceDocument.querySelectorAll("[data-toc-delete]").forEach((node) => node.remove());
  sourceDocument.querySelectorAll(".study-code-actions").forEach((node) => node.remove());
  sourceDocument.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
  if (!options.includeToc) sourceDocument.querySelectorAll(".auto-toc").forEach((node) => node.remove());
  if (!options.includeImages) sourceDocument.querySelectorAll("img").forEach((node) => node.remove());

  const exportShell = document.createElement("div");
  exportShell.style.position = "fixed";
  exportShell.style.left = "-10000px";
  exportShell.style.top = "0";
  exportShell.style.width = "1120px";
  exportShell.style.background = "#f3efe6";
  exportShell.style.padding = "40px";
  exportShell.style.zIndex = "-1";
  document.body.appendChild(exportShell);

  try {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pages = paginateExportDocument(exportShell, sourceDocument, subject, theme);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    for (const [index, page] of pages.entries()) {
      if (index > 0) pdf.addPage();
      const canvas = await html2canvas(page, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: 1120,
      });
      const dataUrl = canvas.toDataURL("image/png", 1);
      pdf.addImage(dataUrl, "PNG", 0, 0, pageWidth, pageHeight);
    }

    addPageNumbers(pdf);
    pdf.save(`${safeFileName(subject.name)}-${safeFileName(theme.name)}.pdf`);
  } finally {
    exportShell.remove();
  }
}

function paginateExportDocument(exportShell, sourceDocument, subject, theme) {
  const pageHeight = 1414;
  const pages = [];
  const sourceNodes = Array.from(sourceDocument.childNodes).filter((node) => node.textContent?.trim() || node.nodeType === Node.ELEMENT_NODE);

  let page = createVisualPdfPage(subject, theme, pages.length === 0);
  exportShell.appendChild(page);
  pages.push(page);

  sourceNodes.forEach((node) => {
    const clone = node.cloneNode(true);
    page.appendChild(clone);
    const hasHeader = !!page.querySelector("[data-export-header]");
    const singleContentOnPage = page.childNodes.length === (hasHeader ? 2 : 1);
    if (page.scrollHeight > pageHeight && (!singleContentOnPage || hasHeader)) {
      clone.remove();
      page = createVisualPdfPage(subject, theme, false);
      exportShell.appendChild(page);
      pages.push(page);
      page.appendChild(clone);
    }
  });

  return pages;
}

function createVisualPdfPage(subject, theme, includeHeader) {
  const page = document.createElement("div");
  page.className = "study-document pdf-export-document";
  page.style.width = "1000px";
  page.style.height = "1414px";
  page.style.boxSizing = "border-box";
  page.style.overflow = "hidden";
  page.style.margin = "0 auto 40px";
  page.style.background = "#ffffff";
  page.style.borderRadius = "8px";
  page.style.boxShadow = "0 18px 50px rgba(15,23,42,0.12)";
  page.style.padding = "64px 64px 96px";
  page.style.color = "#0f172a";

  if (includeHeader) {
    const header = document.createElement("div");
    header.dataset.exportHeader = "true";
    header.style.marginBottom = "28px";
    header.style.borderBottom = "1px solid rgba(15,23,42,0.12)";
    header.style.paddingBottom = "16px";
    header.innerHTML = `
      <p style="margin:0 0 8px;font-size:14px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:${subject.color || "#2f6f73"}">${escapeHtml(subject.name)}</p>
      <h1 style="margin:0;font-size:34px;line-height:1.12;font-weight:900;color:#172033">${escapeHtml(theme.name)}</h1>
    `;
    page.appendChild(header);
  }

  return page;
}

function drawThemeDocumentHeader(ctx, subject, theme) {
  const accent = hexToRgb(subject.color || "#2f6f73");
  ctx.doc.setTextColor(...accent);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(12);
  ctx.doc.text(subject.name, ctx.margin, ctx.y);
  ctx.y += 10;

  ctx.doc.setTextColor(23, 32, 51);
  ctx.doc.setFontSize(26);
  ctx.doc.text(ctx.doc.splitTextToSize(theme.name, ctx.contentWidth), ctx.margin, ctx.y);
  ctx.y += 16;

  ctx.doc.setDrawColor(226, 232, 240);
  ctx.doc.line(ctx.margin, ctx.y, ctx.pageWidth - ctx.margin, ctx.y);
  ctx.y += 12;
}

function renderHtmlDocumentToPdf(ctx, html = "", options = { includeToc: true, includeImages: true }) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  if (!options.includeToc) doc.querySelectorAll(".auto-toc").forEach((node) => node.remove());
  const nodes = Array.from(doc.body.childNodes);
  if (!nodes.length) {
    addPdfParagraph(ctx, "No hay apuntes escritos todavia.");
    return;
  }
  nodes.forEach((node) => renderPdfNode(ctx, node, options));
}

function renderPdfNode(ctx, node, options = { includeImages: true }) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    if (text) addPdfParagraph(ctx, text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toLowerCase();
  if (tag === "img") {
    if (!options.includeImages) return;
    const src = node.getAttribute("src");
    if (src?.startsWith("data:image")) addPdfImage(ctx, src);
    return;
  }

  if (["h1", "h2", "h3", "h4"].includes(tag)) {
    const level = Number(tag.slice(1));
    const sizes = { 1: 22, 2: 17, 3: 14, 4: 12 };
    addPdfParagraph(ctx, node.textContent || "", {
      size: sizes[level],
      bold: true,
      color: level === 1 ? [23, 32, 51] : [31, 93, 85],
      gap: level === 1 ? 6 : 4,
    });
    return;
  }

  if (tag === "li") {
    addPdfParagraph(ctx, `- ${node.textContent || ""}`, { indent: 4 });
    return;
  }

  if (tag === "p" || tag === "blockquote" || tag === "a") {
    addPdfParagraph(ctx, node.textContent || "");
    return;
  }

  if (tag === "br") {
    ctx.y += 4;
    return;
  }

  Array.from(node.childNodes).forEach((child) => renderPdfNode(ctx, child, options));
  if (tag === "div" || tag === "ul" || tag === "ol") ctx.y += 2;
}

function exportSubjectQuestionsToPdf(subject) {
  try {
    const questions = subject.qa || [];
    const dominated = questions.filter((item) => item.status === "dominada").length;
    const ctx = createPdfContext();

    drawPdfCover(ctx, {
      eyebrow: subject.name,
      title: "Preguntas y respuestas",
      subtitle: "Banco de preguntas de teoria de la asignatura",
      meta: [`Exportado: ${formatExportDate()}`, `Total de preguntas: ${questions.length}`, `Dominadas: ${dominated}`],
      color: subject.color,
    });

    addPdfSection(ctx, "Listado de preguntas");
    if (!questions.length) {
      addPdfParagraph(ctx, "Todavia no hay preguntas guardadas en esta asignatura.");
    }

    questions.forEach((item, index) => {
      const tone = qaPdfTone(item.status);
      ensurePdfSpace(ctx, 34);
      ctx.doc.setFillColor(255, 255, 255);
      ctx.doc.setDrawColor(226, 232, 240);
      ctx.doc.roundedRect(ctx.margin, ctx.y, ctx.contentWidth, 10, 2, 2, "FD");
      ctx.doc.setFillColor(...tone.rgb);
      ctx.doc.roundedRect(ctx.margin, ctx.y, 2.2, 10, 1, 1, "F");
      ctx.doc.setTextColor(...tone.rgb);
      ctx.doc.setFont("helvetica", "bold");
      ctx.doc.setFontSize(10);
      ctx.doc.text(readable(item.status).toUpperCase(), ctx.margin + 6, ctx.y + 6.5);
      ctx.y += 15;

      addPdfParagraph(ctx, `Pregunta ${index + 1}:`, { size: 13, bold: true, color: tone.rgb, gap: 1 });
      addPdfParagraph(ctx, item.question || "Sin pregunta.", { size: 11, gap: 5 });
      addPdfParagraph(ctx, "Respuesta:", { size: 12, bold: true, color: [23, 32, 51], gap: 1 });
      addPdfParagraph(ctx, item.answer || "Sin respuesta.", { size: 11, gap: 8 });
    });

    addPageNumbers(ctx.doc);
    ctx.doc.save(`${safeFileName(subject.name)}-preguntas-y-respuestas.pdf`);
  } catch (error) {
    console.error(error);
    window.alert("No se han podido exportar las preguntas a PDF.");
  }
}

function createPdfContext() {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  return { doc, pageWidth, pageHeight, margin, contentWidth: pageWidth - margin * 2, y: margin };
}

function drawPdfCover(ctx, { eyebrow, title, subtitle, meta, color }) {
  const accent = hexToRgb(color || "#2f6f73");
  ctx.doc.setFillColor(...accent);
  ctx.doc.rect(0, 0, ctx.pageWidth, 58, "F");
  ctx.doc.setTextColor(255, 255, 255);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(12);
  ctx.doc.text(String(eyebrow || "").toUpperCase(), ctx.margin, 24);
  ctx.doc.setFontSize(28);
  ctx.doc.text(ctx.doc.splitTextToSize(title || "Exportacion", ctx.contentWidth), ctx.margin, 39);
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(12);
  ctx.doc.text(ctx.doc.splitTextToSize(subtitle || "", ctx.contentWidth), ctx.margin, 68);
  ctx.y = 86;
  (meta || []).forEach((line) => addPdfChip(ctx, line, accent));
  ctx.y += 8;
}

function addPdfChip(ctx, text, accent) {
  const width = Math.min(ctx.contentWidth, ctx.doc.getTextWidth(text) + 12);
  ensurePdfSpace(ctx, 10);
  ctx.doc.setFillColor(244, 247, 250);
  ctx.doc.roundedRect(ctx.margin, ctx.y, width, 8, 2, 2, "F");
  ctx.doc.setTextColor(...accent);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(9);
  ctx.doc.text(text, ctx.margin + 5, ctx.y + 5.4);
  ctx.y += 10;
}

function addPdfSection(ctx, title) {
  ensurePdfSpace(ctx, 18);
  ctx.doc.setDrawColor(226, 232, 240);
  ctx.doc.line(ctx.margin, ctx.y, ctx.pageWidth - ctx.margin, ctx.y);
  ctx.y += 9;
  ctx.doc.setTextColor(23, 32, 51);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(17);
  ctx.doc.text(title, ctx.margin, ctx.y);
  ctx.y += 8;
}

function addPdfParagraph(ctx, text, options = {}) {
  const { size = 11, bold = false, color = [51, 65, 85], gap = 4, indent = 0 } = options;
  const clean = String(text || "").replace(/\s+\n/g, "\n").trim();
  const paragraphs = clean ? clean.split(/\n{2,}/) : ["-"];
  ctx.doc.setFont("helvetica", bold ? "bold" : "normal");
  ctx.doc.setFontSize(size);
  ctx.doc.setTextColor(...color);
  paragraphs.forEach((paragraph) => {
    const lines = ctx.doc.splitTextToSize(paragraph.replace(/\n/g, " "), ctx.contentWidth - indent);
    const lineHeight = size * 0.45;
    lines.forEach((line) => {
      ensurePdfSpace(ctx, lineHeight + gap);
      ctx.doc.text(line, ctx.margin + indent, ctx.y);
      ctx.y += lineHeight;
    });
    ctx.y += gap;
  });
}

function addListSection(ctx, title, items = [], readItem) {
  addPdfSection(ctx, title);
  if (!items?.length) {
    addPdfParagraph(ctx, "No hay elementos en esta seccion.");
    return;
  }
  items.forEach((item, index) => {
    const [heading, body] = readItem(item);
    addPdfParagraph(ctx, `${index + 1}. ${heading || "Sin titulo"}`, { bold: true, color: [23, 32, 51], gap: 1 });
    addPdfParagraph(ctx, body || "Sin contenido.", { indent: 4 });
  });
}

async function addMediaSection(ctx, media = []) {
  addPdfSection(ctx, "Imagenes, capturas y PDFs");
  if (!media.length) {
    addPdfParagraph(ctx, "No hay imagenes, capturas ni PDFs adjuntos.");
    return;
  }

  for (const file of media) {
    addPdfParagraph(ctx, file.name || "Archivo adjunto", { bold: true, color: [23, 32, 51], gap: 1 });
    if (file.type === "pdf") {
      addPdfParagraph(ctx, "PDF adjunto al tema.");
      continue;
    }
    const dataUrl = await getMediaDataUrl(file);
    if (dataUrl) addPdfImage(ctx, dataUrl);
    else addPdfParagraph(ctx, "No se ha podido cargar la vista previa de esta imagen.");
  }
}

async function addDocumentImages(ctx, html) {
  const images = extractDocumentImages(html);
  if (!images.length) return;
  addPdfSection(ctx, "Imagenes insertadas en los apuntes");
  for (const src of images) addPdfImage(ctx, src);
}

function addResourcesSection(ctx, theme) {
  const resources = [
    ...(theme.links || []).map((item) => ({ title: item.title, body: item.url })),
    ...(theme.videos || []).map((item) => ({ title: item.title, body: item.url })),
    ...(theme.resources || []).map((item) => ({ title: `${item.title} (${item.type || "recurso"})`, body: item.url })),
  ];
  addListSection(ctx, "Recursos asociados", resources, (item) => [item.title, item.body]);
}

function addPdfImage(ctx, dataUrl) {
  try {
    const props = ctx.doc.getImageProperties(dataUrl);
    const width = Math.min(ctx.contentWidth, props.width > props.height ? 150 : 95);
    const height = (props.height * width) / props.width;
    const finalHeight = Math.min(height, 130);
    const finalWidth = (props.width * finalHeight) / props.height;
    ensurePdfSpace(ctx, finalHeight + 8);
    ctx.doc.addImage(dataUrl, getImageFormat(dataUrl), ctx.margin, ctx.y, Math.min(width, finalWidth), finalHeight);
    ctx.y += finalHeight + 8;
  } catch {
    addPdfParagraph(ctx, "No se ha podido insertar una imagen en el PDF.");
  }
}

function ensurePdfSpace(ctx, needed) {
  if (ctx.y + needed <= ctx.pageHeight - 18) return;
  ctx.doc.addPage();
  ctx.y = ctx.margin;
}

function addPageNumbers(doc) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(`Pagina ${page} de ${total}`, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 9, { align: "center" });
  }
}

async function getMediaDataUrl(file) {
  if (file.dataUrl) return file.dataUrl;
  if (!file.fileId) return "";
  const stored = await getStoredFile(file.fileId);
  if (!stored?.blob) return "";
  return blobToDataUrl(stored.blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function htmlToText(html = "") {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll(".auto-toc, script, style").forEach((node) => node.remove());
  doc.querySelectorAll("h1, h2, h3, h4, p, li, blockquote").forEach((node) => {
    node.appendChild(doc.createTextNode("\n"));
  });
  return doc.body.innerText.replace(/\n{3,}/g, "\n\n").trim();
}

function extractDocumentImages(html = "") {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("img")).map((image) => image.src).filter((src) => src?.startsWith("data:image"));
}

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "");
  const value = clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) || 0);
}

function qaPdfTone(status) {
  return {
    pendiente: { rgb: [100, 116, 139] },
    repasando: { rgb: [196, 132, 22] },
    dominada: { rgb: [47, 143, 91] },
  }[status] || { rgb: [100, 116, 139] };
}

function formatExportDate() {
  return new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function safeFileName(value = "exportacion") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "exportacion";
}

function getImageFormat(dataUrl) {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

function readable(value = "") {
  return String(value).replaceAll("-", " ");
}

export default App;
