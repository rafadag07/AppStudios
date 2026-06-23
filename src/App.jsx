import { useEffect, useMemo, useRef, useState } from "react";
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
  Network,
  Paperclip,
  Pencil,
  Plus,
  Quote,
  Save,
  Search,
  Sigma,
  Sparkles,
  Trash2,
  Underline,
  Upload,
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
          <ThemePage subject={currentSubject} theme={currentTheme} openModal={setModal} updateData={updateData} setView={setView} />
        )}
        {view.page === "calendar" && <CalendarPage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "schedule" && <SchedulePage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "tasks" && <TasksPage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "resources" && <ResourcesPage data={data} openModal={setModal} updateData={updateData} />}
        {view.page === "pomodoro" && <PomodoroPage />}
      </Shell>

      {modal && <EditorModal modal={modal} close={() => setModal(null)} data={data} updateData={updateData} />}
    </div>
  );
}

function Shell({ children, view, setView, subjects, query, setQuery, openModal, cloudUser, syncStatus, onCloudSignIn, onCodeSignIn, onCloudSignOut }) {
  const nav = [
    ["dashboard", "Campus", Sparkles],
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
        <button onClick={() => setView({ page: "dashboard" })} className="mb-8 flex items-center gap-3 text-left">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-[#172033] text-white">
            <Sparkles size={22} />
          </span>
          <span>
            <span className="block text-lg font-black">Campus Verano</span>
            <span className="text-sm text-slate-500">Estudio personal</span>
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
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-900/10 bg-[#f7f4ee]/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
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
      <section className="grid gap-4 lg:grid-cols-[1.45fr_0.55fr]">
        <div className="overflow-hidden rounded-lg bg-[#172033] text-white shadow-soft">
          <div className="grid gap-6 p-6 md:grid-cols-[1fr_260px] md:p-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#f4c36b]">Dashboard principal</p>
              <h1 className="mt-3 max-w-2xl text-4xl font-black leading-tight md:text-6xl">Tu campus de estudio de verano</h1>
              <p className="mt-4 max-w-xl text-base text-white/70">
                Un espacio visual para moverte de asignaturas a temas, trabajar apuntes y mantener visible lo próximo.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <ActionButton icon={Plus} label="Nueva asignatura" onClick={() => openModal({ type: "subject" })} />
                <ActionButton icon={ListChecks} label="Nueva tarea" onClick={() => openModal({ type: "task" })} />
                <ActionButton icon={LinkIcon} label="Nuevo recurso" onClick={() => openModal({ type: "resource" })} />
              </div>
            </div>
            <div className="grid content-end gap-3">
              <Metric label="Tareas pendientes" value={stats.pendingTasks} />
              <Metric label="Temas completados" value={`${stats.completedThemes}/${stats.totalThemes}`} />
            </div>
          </div>
        </div>
        <PomodoroCard />
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
      <PageTitle title="Asignaturas" subtitle="Organiza cada materia como un edificio propio del campus." action={() => openModal({ type: "subject" })} />
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
  const qaCount = subject.qa?.length || 0;
  const dominatedCount = subject.qa?.filter((item) => item.status === "dominada").length || 0;
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
            <ActionButton icon={Plus} label="Tema" onClick={() => openModal({ type: "theme", subjectId: subject.id })} />
            <ActionButton icon={HelpCircle} label={`Preguntas ${qaCount}/${dominatedCount}`} onClick={() => setView({ page: "subject-qa", subjectId: subject.id })} />
          </div>
        </div>
      </section>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {subject.themes.map((theme) => (
          <ThemeCard key={theme.id} theme={theme} subject={subject} setView={setView} openModal={openModal} updateData={updateData} />
        ))}
      </div>
    </div>
  );
}

function ThemePage({ subject, theme, openModal, updateData, setView }) {
  const fileInputRef = useRef(null);
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
            <button onClick={() => exportThemeToPdf(subject, theme)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#172033] px-4 text-sm font-black text-white shadow-sm hover:bg-[#22304a]">
              <FileText size={18} /> Exportar tema a PDF
            </button>
            <Badge>{theme.status}</Badge>
            <Badge tone={theme.priority === "alta" ? "hot" : "cool"}>{theme.priority}</Badge>
            <IconButton icon={Pencil} label="Editar tema" onClick={() => openModal({ type: "theme", subjectId: subject.id, item: theme })} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <RichTextEditor key={theme.id} value={documentHtml} onChange={updateDocument} />
        <aside className="space-y-4">
          <ThemeSection title="PDFs e imágenes" icon={Paperclip} onAdd={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={addFile} />
            {theme.media.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">
                Añade PDFs, capturas o imágenes para tenerlos junto a tus apuntes.
              </div>
            ) : (
              <div className="grid gap-2">
                {theme.media.map((file) => (
                  <StoredFileLink key={file.id} file={file} onDelete={() => deleteFile(file.id)} />
                ))}
              </div>
            )}
          </ThemeSection>
          <section className="rounded-lg border border-slate-900/10 bg-white p-4">
            <h2 className="flex items-center gap-2 font-black"><Save size={18} /> Guardado</h2>
            <p className="mt-2 text-sm text-slate-600">El documento se guarda automáticamente en este navegador mientras escribes.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const editorFrameRef = useRef(null);
  const fileInputRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageWidth, setImageWidth] = useState(70);
  const [imageTools, setImageTools] = useState(null);

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = value || emptyThemeDocument();
    refreshToc();
  }, []);

  const saveDocument = () => {
    refreshToc();
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
    if (event.target?.tagName === "IMG") {
      selectedImage?.classList.remove("selected-editor-image");
      event.target.classList.add("selected-editor-image");
      setSelectedImage(event.target);
      const width = Number.parseInt(event.target.style.width, 10);
      setImageWidth(Number.isFinite(width) ? width : 70);
      updateImageToolsPosition(event.target);
      return;
    }
    selectedImage?.classList.remove("selected-editor-image");
    setSelectedImage(null);
    setImageTools(null);
    saveSelection();
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
    selectedImage.style.float = "";
    selectedImage.style.display = "block";
    selectedImage.style.margin = "1rem auto";
    if (align === "left") {
      selectedImage.style.float = "left";
      selectedImage.style.margin = "0.5rem 1.25rem 0.75rem 0";
    }
    if (align === "right") {
      selectedImage.style.float = "right";
      selectedImage.style.margin = "0.5rem 0 0.75rem 1.25rem";
    }
    if (align === "center") {
      selectedImage.style.float = "";
      selectedImage.style.margin = "1rem auto";
    }
    window.requestAnimationFrame(() => updateImageToolsPosition(selectedImage));
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

  return (
    <section className="overflow-hidden rounded-lg border border-slate-900/10 bg-white shadow-soft">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-900/10 bg-slate-50 px-3 py-3">
        <EditorTool icon={Heading1} label="Título" onClick={() => runCommand("formatBlock", "h1")} />
        <EditorTool icon={Heading2} label="Subtítulo 1" onClick={() => runCommand("formatBlock", "h2")} />
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("formatBlock", "h3")} className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100">S2</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("formatBlock", "h4")} className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100">S3</button>
        <EditorTool icon={Bold} label="Negrita" onClick={() => runCommand("bold")} />
        <EditorTool icon={Italic} label="Cursiva" onClick={() => runCommand("italic")} />
        <EditorTool icon={Underline} label="Subrayado" onClick={() => runCommand("underline")} />
        <EditorTool icon={List} label="Lista" onClick={() => runCommand("insertUnorderedList")} />
        <EditorTool icon={ListOrdered} label="Lista numerada" onClick={() => runCommand("insertOrderedList")} />
        <EditorTool icon={Quote} label="Cita" onClick={() => runCommand("formatBlock", "blockquote")} />
        <EditorTool icon={Image} label="Imagen dentro del apunte" onClick={() => fileInputRef.current?.click()} />
        <button
          type="button"
          onClick={() => runCommand("removeFormat")}
          className="h-9 rounded-lg bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-100"
        >
          Limpiar
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={addInlineImage} />
      </div>
      <div ref={editorFrameRef} className="relative bg-[#f3efe6] px-3 py-5 md:px-8">
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
          onPaste={handlePaste}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onScroll={() => selectedImage && updateImageToolsPosition(selectedImage)}
          className="study-document mx-auto min-h-[760px] max-w-4xl rounded bg-white px-8 py-9 text-slate-900 shadow-soft outline-none md:px-14 md:py-12"
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

      <div className="grid grid-cols-7 gap-2">
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

function PomodoroPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PomodoroCard full />
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
          <div className="grid gap-3 md:grid-cols-3">
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
  if (modal.type === "subject") upsert(draft.subjects, { ...form, id: modal.item?.id || createId("subject"), themes: modal.item?.themes || [], qa: modal.item?.qa || [] });
  if (modal.type === "theme") {
    const subject = draft.subjects.find((entry) => entry.id === modal.subjectId);
    upsert(subject.themes, {
      ...form,
      id: modal.item?.id || createId("theme"),
      subjectId: modal.subjectId,
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
      status: modal.type === "theme" ? normalizeStudyState(modal.item.status) : modal.item.status,
      title: modal.item.title || modal.item.name || modal.item.question || modal.item.label || "",
    };
  }
  const base = { title: "", name: "", description: "", url: "", body: "", content: "", question: "", label: "" };
  if (modal.type === "subject") return { ...base, name: "", color: "#2f6f73", icon: "network", targetDate: todayIso() };
  if (modal.type === "theme") return { ...base, name: "", status: "pendiente", priority: "media", targetDate: todayIso(), coverImage: "" };
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

function ThemeCard({ theme, subject, setView, openModal }) {
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

function StoredFileLink({ file, onDelete }) {
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
          <a href={href || "#"} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">Abrir</a>
          <button type="button" onClick={onDelete} className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-700">Borrar</button>
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
      return `<a class="toc-level-${level}" href="#${heading.id}">${text}</a>`;
    })
    .join("");
  toc.innerHTML = `<h2>Índice</h2>${items || '<p class="toc-empty">Añade títulos y subtítulos para crear el índice.</p>'}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function exportThemeToPdf(subject, theme) {
  try {
    const ctx = createPdfContext();
    const documentHtml = theme.documentHtml || buildThemeDocument(theme);

    drawThemeDocumentHeader(ctx, subject, theme);
    renderHtmlDocumentToPdf(ctx, documentHtml);

    addPageNumbers(ctx.doc);
    ctx.doc.save(`${safeFileName(subject.name)}-${safeFileName(theme.name)}.pdf`);
  } catch (error) {
    console.error(error);
    window.alert("No se ha podido exportar el tema a PDF. Revisa si algun archivo adjunto esta danado.");
  }
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

function renderHtmlDocumentToPdf(ctx, html = "") {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nodes = Array.from(doc.body.childNodes);
  if (!nodes.length) {
    addPdfParagraph(ctx, "No hay apuntes escritos todavia.");
    return;
  }
  nodes.forEach((node) => renderPdfNode(ctx, node));
}

function renderPdfNode(ctx, node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    if (text) addPdfParagraph(ctx, text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toLowerCase();
  if (tag === "img") {
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

  Array.from(node.childNodes).forEach((child) => renderPdfNode(ctx, child));
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
