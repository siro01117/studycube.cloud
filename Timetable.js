const { useState, useMemo, useEffect, useRef } = React;

// [클라우드 설정]
const SUPABASE_URL = 'https://ovnabmmofgujgefuamzn.supabase.co';
const SUPABASE_KEY = 'YOUR_ANON_KEY_HERE'; 
const _db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const START_HOUR = 7;
const END_HOUR = 24;
const SLOT_HEIGHT = 100;
const TOTAL_MINUTES = (END_HOUR - START_HOUR + 1) * 60;
const DEFAULT_COLORS = ['#E59A9A', '#E5B981', '#DEE08C', '#A8D99C', '#8CCEDB', '#89AED9', '#A59BD9', '#D9A9D9', '#C2CDC9'];

const App = () => {
    const captureRef = useRef(null);
    const [isAuth, setIsAuth] = useState(false);
    const [students, setStudents] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    
    // 모달 및 폼 상태
    const [studentModal, setStudentModal] = useState({ open: false, editId: null, name: '' });
    const [scheduleModal, setScheduleModal] = useState({ open: false, editId: null });
    const [detailModal, setDetailModal] = useState({ open: false, item: null });
    const [sForm, setSForm] = useState({ title: '', days: [], startH: '09', startM: '00', endH: '10', endM: '00', tags: [], memo: '', color: DEFAULT_COLORS[0] });

    // [1. 데이터 동기화 엔진]
    useEffect(() => { if (isAuth) fetchStudents(); }, [isAuth]);

    const fetchStudents = async () => {
        const { data } = await _db.from('schedules').select('*').order('updated_at', { ascending: false });
        if (data) {
            setStudents(data.map(s => ({
                id: s.id, name: s.student_name, 
                schedules: s.data?.schedules || [], isDeleted: s.data?.isDeleted || false
            })));
        }
    };

    const syncToCloud = async (target) => {
        await _db.from('schedules').upsert({
            id: target.id, student_name: target.name,
            data: { schedules: target.schedules, isDeleted: target.isDeleted },
            updated_at: new Date()
        });
    };

    // [2. 학생 관리 CRUD]
    const handleSaveStudent = async () => {
        if (!studentModal.name.trim()) return;
        const newStudent = { id: studentModal.editId || Date.now(), name: studentModal.name, schedules: current?.schedules || [], isDeleted: false };
        setStudents(prev => [newStudent, ...prev.filter(x => x.id !== newStudent.id)]);
        await syncToCloud(newStudent);
        setStudentModal({ open: false, editId: null, name: '' });
        setSelectedId(newStudent.id);
    };

    const handleDeleteStudent = async (id) => {
        if (!confirm("해당 학생의 모든 데이터를 삭제하시겠습니까?")) return;
        const { error } = await _db.from('schedules').delete().eq('id', id);
        if (!error) {
            setStudents(prev => prev.filter(s => s.id !== id));
            if (selectedId === id) setSelectedId(null);
        }
    };

    // [3. 일정 관리 엔진 (핵심 요구사항)]
    const handleSaveSchedule = async () => {
        if (!sForm.title || sForm.days.length === 0) return;
        const start = parseInt(sForm.startH) * 60 + parseInt(sForm.startM);
        const end = parseInt(sForm.endH) * 60 + parseInt(sForm.endM);
        if (end <= start) return alert("종료 시간 오류");

        const newSchedule = { ...sForm, id: scheduleModal.editId || Date.now() };
        const updatedSchedules = scheduleModal.editId 
            ? current.schedules.map(s => s.id === scheduleModal.editId ? newSchedule : s)
            : [...current.schedules, newSchedule];

        const updatedStudent = { ...current, schedules: updatedSchedules };
        setStudents(prev => prev.map(s => s.id === selectedId ? updatedStudent : s));
        await syncToCloud(updatedStudent);
        setScheduleModal({ open: false, editId: null });
    };

    const current = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);

    // [보안 게이트웨이 호출]
    if (!isAuth) return window.AuthSystem.renderGate(setIsAuth);

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
            {/* SIDEBAR: 학생 리스트 */}
            <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-30 shadow-md">
                <div className="p-8 border-b border-slate-100">
                    <h1 className="text-2xl font-black italic tracking-tighter uppercase mb-8 text-center text-slate-800">Study Cube</h1>
                    <button onClick={() => setStudentModal({ open: true, editId: null, name: '' })} className="w-full bg-blue-600 py-5 rounded-[2rem] font-black text-white shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3">
                        <Icon name="user-plus" size={24} /> 학생 추가
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {students.map(s => (
                        <div key={s.id} onClick={() => setSelectedId(s.id)} className={`group p-6 rounded-2xl cursor-pointer border-2 flex items-center justify-between transition-all ${selectedId === s.id ? 'bg-blue-50 border-blue-400 shadow-md' : 'bg-white border-transparent hover:border-slate-100'}`}>
                            <span className="font-black text-xl text-slate-700 truncate flex-1">{s.name}</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteStudent(s.id); }} className="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:text-red-600 transition-all"><Icon name="trash-2" size={18} /></button>
                        </div>
                    ))}
                </div>
            </aside>

            {/* MAIN DASHBOARD */}
            <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
                {current ? (
                    <>
                        <header className="h-24 border-b border-slate-100 flex items-center justify-between px-10 bg-white z-10 shadow-sm">
                            <h2 className="text-2xl font-black italic uppercase tracking-tight text-slate-800">{current.name} 주간 시스템</h2>
                            <div className="flex items-center gap-4">
                                <button onClick={() => window.ExportSystem.generate(captureRef.current, current.name, 'png')} className="px-6 py-3 bg-emerald-500 text-white rounded-xl font-black shadow-lg hover:bg-emerald-600 transition-all uppercase">PNG</button>
                                <button onClick={() => window.ExportSystem.generate(captureRef.current, current.name, 'pdf')} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg hover:bg-blue-700 transition-all uppercase">PDF</button>
                                <button onClick={() => setIsEditMode(!isEditMode)} className={`px-8 py-3 rounded-xl font-black shadow-xl transition-all ${isEditMode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                                    {isEditMode ? '저장 종료' : '일정 편집'}
                                </button>
                            </div>
                        </header>

                        <div className="flex-1 overflow-auto bg-slate-50/50 p-12 custom-scrollbar">
                            {/* EXPORT AREA: 고해상도 캡처 대상 */}
                            <div ref={captureRef} className="export-area bg-white p-16 rounded-[4rem] shadow-2xl border border-slate-100 mx-auto">
                                <div className="mb-12 border-b-4 border-slate-900 pb-10 flex justify-between items-end">
                                    <h1 className="text-4xl font-black text-slate-900 tracking-tight italic uppercase">{current.name} 주간 계획표</h1>
                                    <span className="text-slate-400 font-black text-xl uppercase tracking-widest leading-none">| STUDY CUBE</span>
                                </div>

                                <div className="flex gap-12">
                                    {/* TIME GRID ENGINE */}
                                    <div className="flex-1 grid-layout divide-x-2 divide-slate-100 border-2 border-slate-100 rounded-[3.5rem] overflow-hidden shadow-2xl bg-white">
                                        <div className="bg-slate-50/50 flex flex-col text-center">
                                            <div className="h-20 border-b-4 border-slate-900 flex items-center justify-center text-[14px] font-black italic text-slate-900 uppercase">TIME</div>
                                            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                                                <div key={i} className="time-slot flex items-center justify-center text-[18px] font-black text-slate-300">{START_HOUR + i}</div>
                                            ))}
                                        </div>
                                        {DAYS.map(day => (
                                            <div key={day} className="flex flex-col relative min-w-[160px]">
                                                <div className="h-20 border-b-4 border-slate-900 flex items-center justify-center text-xl font-black text-slate-900">{day}</div>
                                                <div className="flex-1 relative bg-white/40">
                                                    {current.schedules.filter(s => s.days.includes(day)).map(s => {
                                                        const startMin = (parseInt(s.startH) * 60 + parseInt(s.startM)) - (START_HOUR * 60);
                                                        const durMin = (parseInt(s.endH) * 60 + parseInt(s.endM)) - (parseInt(s.startH) * 60 + parseInt(s.startM));
                                                        const topPos = (startMin / TOTAL_MINUTES) * (END_HOUR - START_HOUR + 1) * SLOT_HEIGHT;
                                                        const height = (durMin / TOTAL_MINUTES) * (END_HOUR - START_HOUR + 1) * SLOT_HEIGHT;
                                                        return (
                                                            <div key={s.id} onClick={() => isEditMode ? setScheduleModal({ open: true, editId: s.id }) : setDetailModal({ open: true, item: s })}
                                                                className={`absolute left-1 right-1 rounded-2xl p-4 shadow-xl border border-black/5 flex flex-col overflow-hidden transition-all hover:scale-105 hover:z-20 cursor-pointer ${isEditMode ? 'ring-4 ring-blue-500/30 ring-offset-1' : ''}`}
                                                                style={{ top: `${topPos}px`, height: `${height}px`, backgroundColor: s.color }}>
                                                                <span className="font-black text-[15px] uppercase leading-tight truncate text-slate-900">{s.title}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {isEditMode && (
                            <button onClick={() => { setSForm({title:'', days:[], startH:'09', startM:'00', endH:'10', endM:'00', tags:[], memo:'', color:DEFAULT_COLORS[0]}); setScheduleModal({ open: true, editId: null }); }} 
                                className="absolute bottom-12 right-12 w-24 h-24 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center active:scale-90 transition-all z-20 shadow-blue-500/40">
                                <Icon name="plus" size={48} />
                            </button>
                        )}
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-200">
                        <Icon name="mouse-pointer-2" size={120} className="mb-10 opacity-10" />
                        <p className="text-3xl font-black uppercase italic tracking-[0.3em]">Select Student to Start</p>
                    </div>
                )}
            </main>

            {/* MODAL: 학생 추가 (CRUD 1) */}
            {studentModal.open && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xl flex items-center justify-center z-[500] p-6">
                    <div className="bg-white p-16 rounded-[4rem] w-full max-w-lg shadow-2xl text-center modal-animate">
                        <h3 className="text-4xl font-black mb-10 italic uppercase text-slate-800">New Identity</h3>
                        <input type="text" autoFocus value={studentModal.name} onChange={(e) => setStudentModal({...studentModal, name: e.target.value})} onKeyDown={(e) => e.key === 'Enter' && handleSaveStudent()} placeholder="이름 입력"
                            className="w-full border-4 border-slate-50 p-8 rounded-[2rem] text-center text-4xl font-black mb-10 bg-slate-50 outline-none focus:border-blue-500 transition-all" />
                        <div className="flex gap-6">
                            <button onClick={() => setStudentModal({ open: false, editId: null, name: '' })} className="flex-1 py-8 font-black text-slate-300 hover:text-slate-500 uppercase tracking-widest">CANCEL</button>
                            <button onClick={handleSaveStudent} className="flex-[2] py-8 bg-slate-900 text-white rounded-[2.5rem] font-black text-2xl shadow-2xl">확정</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
