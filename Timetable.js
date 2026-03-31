const { useState, useMemo, useEffect, useRef } = React;

// [시스템 환경 설정]
const SUPABASE_URL = 'https://ovnabmmofgujgefuamzn.supabase.co';
const SUPABASE_KEY = 'YOUR_ANON_KEY_HERE'; // 발급받은 ANON_KEY를 입력하세요.
const _db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const ACCESS_PW = "R040117!";

// [공통 컴포넌트: Lucide 아이콘 렌더러]
const Icon = ({ name, size = 20, className = "" }) => {
    const pascalName = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    const iconData = lucide.icons[pascalName] || lucide.icons[name];
    if (!iconData) return null;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}
            dangerouslySetInnerHTML={{ __html: iconData.map(item => `<${item[0]} ${Object.entries(item[1]).map(([k, v]) => `${k}="${v}"`).join(' ')}></${item[0]}>`).join('') }}
        />
    );
};

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
    const [filterTitle, setFilterTitle] = useState('');
    const [filterTag, setFilterTag] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const [scheduleModal, setScheduleModal] = useState({ open: false, editId: null });
    const [studentModal, setStudentModal] = useState({ open: false, editId: null, name: '' });
    const [detailModal, setDetailModal] = useState({ open: false, item: null });

    const [tags, setTags] = useState(['인강', '자습', '학원', '수업', '과외']);
    const [sForm, setSForm] = useState({ title: '', days: [], startH: '09', startM: '00', endH: '10', endM: '00', tags: [], memo: '', color: DEFAULT_COLORS[0] });

    // [1. 클라우드 데이터 동기화 로직]
    useEffect(() => {
        if (isAuth) fetchStudents();
    }, [isAuth]);

    const fetchStudents = async () => {
        const { data, error } = await _db.from('schedules').select('*').order('updated_at', { ascending: false });
        if (data) {
            setStudents(data.map(s => ({
                id: s.id,
                name: s.student_name,
                ...s.data
            })));
        }
    };

    const syncToCloud = async (targetStudent) => {
        const { error } = await _db.from('schedules').upsert({
            id: targetStudent.id,
            student_name: targetStudent.name,
            data: { 
                schedules: targetStudent.schedules, 
                isDeleted: targetStudent.isDeleted || false 
            },
            updated_at: new Date()
        });
        if (error) console.error("Sync Error:", error);
    };

    // [2. 정밀 캡처 & PDF 엔진]
    const handleExport = async (format) => {
        if (!captureRef.current || !current) return;
        await document.fonts.ready;

        const canvas = await html2canvas(captureRef.current, {
            backgroundColor: "#ffffff",
            scale: 3,
            useCORS: true,
            width: 1700,
            windowWidth: 1700,
            onclone: (clonedDoc) => {
                const area = clonedDoc.querySelector('.export-area');
                if (area) area.style.height = 'auto';
            }
        });

        const imgData = canvas.toDataURL('image/png', 1.0);

        if (format === 'png') {
            saveAs(imgData, `${current.name}_STUDYCUBE.png`);
        } else if (format === 'pdf') {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('l', 'px', [canvas.width, canvas.height]);
            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`${current.name}_STUDYCUBE.pdf`);
        }
    };

    // [3. 보조 연산 로직]
    const current = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);
    
    const filteredSchedules = useMemo(() => {
        if (!current) return [];
        return current.schedules.filter(s => 
            s.title.toLowerCase().includes(filterTitle.toLowerCase()) &&
            (filterTag === '' || s.tags.some(t => t.includes(filterTag)))
        );
    }, [current, filterTitle, filterTag]);

    const statistics = useMemo(() => {
        const total = filteredSchedules.reduce((acc, s) => {
            const duration = (parseInt(s.endH)*60+parseInt(s.endM)) - (parseInt(s.startH)*60+parseInt(s.startM));
            return acc + (duration * s.days.length);
        }, 0);
        return { total, avg: Math.round(total / 7) };
    }, [filteredSchedules]);

    const handleSaveStudent = async () => {
        const newId = studentModal.editId || Date.now();
        const newStudent = { id: newId, name: studentModal.name, schedules: current?.schedules || [] };
        
        setStudents(prev => {
            const exists = prev.find(x => x.id === newId);
            return exists ? prev.map(x => x.id === newId ? newStudent : x) : [...prev, newStudent];
        });
        
        await syncToCloud(newStudent);
        setStudentModal({ open: false, editId: null, name: '' });
    };

    const handleSaveSchedule = async () => {
        const newSchedule = { ...sForm, id: scheduleModal.editId || Date.now() };
        const updatedSchedules = scheduleModal.editId 
            ? current.schedules.map(s => s.id === scheduleModal.editId ? newSchedule : s)
            : [...current.schedules, newSchedule];

        const updatedStudent = { ...current, schedules: updatedSchedules };
        setStudents(prev => prev.map(s => s.id === selectedId ? updatedStudent : s));
        await syncToCloud(updatedStudent);
        setScheduleModal({ open: false, editId: null });
    };

    // [인증 레이어 렌더링]
    if (!isAuth) {
        return (
            <div className="h-screen w-full bg-[#1E1E22] flex items-center justify-center p-6">
                <div className="bg-white p-12 lg:p-20 rounded-[3rem] lg:rounded-[5rem] shadow-2xl text-center max-w-xl w-full">
                    <h2 className="text-4xl lg:text-5xl font-black mb-12 italic uppercase tracking-tighter">System Access</h2>
                    <input 
                        type="password" 
                        autoFocus
                        placeholder="ENTER SECURITY KEY" 
                        className="w-full border-4 border-slate-100 p-8 rounded-[2.5rem] text-center text-3xl font-black mb-12 bg-slate-50 outline-none focus:border-blue-500 transition-all"
                        onKeyDown={(e) => e.key === 'Enter' && (e.target.value === ACCESS_PW ? setIsAuth(true) : alert('접근 권한이 없습니다.'))}
                    />
                    <div className="flex items-center justify-center gap-3 text-slate-300 font-bold uppercase tracking-[0.3em] text-xs">
                        <Icon name="shield-check" size={18} /> STUDY CUBE PROTOCOL v4.0
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
            {/* 사이드바 영역 */}
            <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-30 shadow-md">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h1 className="text-2xl font-black italic tracking-tighter uppercase text-slate-800 mb-6 text-center">Study Cube</h1>
                    <button onClick={() => setStudentModal({ open: true, editId: null, name: '' })} className="w-full bg-blue-600 py-4 rounded-2xl font-black text-lg text-white shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3">
                        <Icon name="user-plus" size={24} /> 학생 등록
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {students.map(s => (
                        <div key={s.id} onClick={() => setSelectedId(s.id)} className={`p-6 rounded-2xl cursor-pointer border-2 flex items-center justify-between transition-all ${selectedId === s.id ? 'bg-blue-50 border-blue-400 shadow-md' : 'bg-white border-transparent hover:border-slate-200'}`}>
                            <div className="font-black text-xl truncate text-slate-800">{s.name}</div>
                        </div>
                    ))}
                </div>
            </aside>

            {/* 메인 대시보드 영역 */}
            <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
                {current ? (
                    <>
                        <header className="h-24 border-b border-slate-100 flex items-center justify-between px-10 shrink-0 bg-white z-10 shadow-sm">
                            <h2 className="text-2xl font-black text-slate-800 tracking-tighter uppercase italic">{current.name} 시간표</h2>
                            <div className="flex items-center gap-4">
                                <button onClick={() => handleExport('png')} className="flex items-center gap-3 px-8 py-4 bg-emerald-500 text-white rounded-2xl font-black text-lg shadow-xl hover:bg-emerald-600 transition-all"><Icon name="image" size={22} /> PNG</button>
                                <button onClick={() => handleExport('pdf')} className="flex items-center gap-3 px-8 py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl hover:bg-blue-700 transition-all"><Icon name="file-text" size={22} /> PDF</button>
                                <button onClick={() => setIsEditMode(!isEditMode)} className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-black text-lg transition-all shadow-xl ${isEditMode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                    <Icon name={isEditMode ? "check" : "edit-3"} size={22} /> {isEditMode ? '완료' : '편집'}
                                </button>
                            </div>
                        </header>

                        <div className="flex-1 overflow-auto bg-slate-50/50 p-12 custom-scrollbar">
                            {/* 캡처 대상 영역 */}
                            <div ref={captureRef} className="export-area bg-white p-16 rounded-[4rem] shadow-2xl border border-slate-100 mx-auto">
                                <div className="mb-12 border-b-4 border-slate-900 pb-10 flex justify-between items-end">
                                    <h1 className="text-4xl font-black text-slate-900 tracking-tight italic uppercase">{current.name} 주간 계획표</h1>
                                    <span className="text-slate-400 font-black text-xl uppercase tracking-widest leading-none">| STUDY CUBE</span>
                                </div>

                                <div className="flex gap-12">
                                    {/* 리포트 패널 */}
                                    <div className="w-80 shrink-0 space-y-10">
                                        <div className="bg-slate-900 text-white p-10 rounded-[3rem] shadow-2xl">
                                            <h3 className="text-[14px] font-black uppercase tracking-[0.3em] opacity-30 mb-10">CORE REPORT</h3>
                                            <div className="space-y-12">
                                                <div className="stat-container">
                                                    <span className="text-6xl stat-number">{Math.floor(statistics.total/60)}</span>
                                                    <span className="text-2xl stat-unit">H</span>
                                                    <span className="text-6xl stat-number ml-8">{statistics.total%60}</span>
                                                    <span className="text-2xl stat-unit">M</span>
                                                </div>
                                                <div className="stat-container text-blue-400">
                                                    <span className="text-5xl stat-number">{Math.floor(statistics.avg/60)}</span>
                                                    <span className="text-xl stat-unit">H/D</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 시간표 메인 그리드 */}
                                    <div className="flex-1 grid-layout grid divide-x-2 divide-slate-100 border-2 border-slate-100 rounded-[3.5rem] overflow-hidden shadow-2xl bg-white">
                                        <div className="bg-slate-50/50 flex flex-col text-center">
                                            <div className="h-20 border-b-4 border-slate-900 flex items-center justify-center text-[14px] font-black italic">TIME</div>
                                            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                                                <div key={i} className="time-slot flex items-center justify-center text-[18px] font-black text-slate-300">{START_HOUR + i}</div>
                                            ))}
                                        </div>
                                        {DAYS.map(day => (
                                            <div key={day} className="flex flex-col relative min-w-[160px]">
                                                <div className="h-20 border-b-4 border-slate-900 flex items-center justify-center text-xl font-black">{day}</div>
                                                <div className="flex-1 relative">
                                                    {filteredSchedules.filter(s => s.days.includes(day)).map(s => {
                                                        const startMin = (parseInt(s.startH) * 60 + parseInt(s.startM)) - (START_HOUR * 60);
                                                        const durMin = (parseInt(s.endH) * 60 + parseInt(s.endM)) - (parseInt(s.startH) * 60 + parseInt(s.startM));
                                                        return (
                                                            <div key={s.id} 
                                                                onClick={() => isEditMode ? setScheduleModal({ open: true, editId: s.id }) : setDetailModal({ open: true, item: s })}
                                                                className="absolute left-1 right-1 rounded-2xl p-4 shadow-lg border border-black/5 overflow-hidden transition-all hover:scale-105 cursor-pointer"
                                                                style={{ 
                                                                    top: `${(startMin / TOTAL_MINUTES) * (END_HOUR - START_HOUR + 1) * SLOT_HEIGHT}px`, 
                                                                    height: `${(durMin / TOTAL_MINUTES) * (END_HOUR - START_HOUR + 1) * SLOT_HEIGHT}px`,
                                                                    backgroundColor: s.color 
                                                                }}>
                                                                <p className="font-black text-sm uppercase leading-tight truncate">{s.title}</p>
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
                            <button onClick={() => setScheduleModal({ open: true, editId: null })} className="absolute bottom-12 right-12 w-24 h-24 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center active:scale-90 transition-all z-20">
                                <Icon name="plus" size={40} />
                            </button>
                        )}
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                        <Icon name="users" size={100} className="opacity-10 mb-8" />
                        <p className="font-black text-2xl uppercase tracking-widest italic">Select Student to Start</p>
                    </div>
                )}
            </main>

            {/* 모달 시스템 (기존 로직 축약본 통합) */}
            {scheduleModal.open && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl flex items-center justify-center z-[200] p-10">
                    <div className="bg-white p-12 rounded-[4rem] w-full max-w-4xl shadow-2xl modal-animate">
                        <h3 className="text-4xl font-black mb-10 italic uppercase">Schedule Editor</h3>
                        <div className="grid grid-cols-2 gap-10">
                            <input type="text" placeholder="ACTIVITY TITLE" className="col-span-2 border-4 border-slate-50 p-8 rounded-[2rem] text-2xl font-black outline-none focus:border-blue-500" value={sForm.title} onChange={e => setSForm({...sForm, title: e.target.value})} />
                            {/* 요일, 시간, 색상 선택 등 상세 입력 UI는 기존 코드 유지 */}
                        </div>
                        <div className="mt-10 flex gap-6">
                            <button onClick={() => setScheduleModal({ open: false, editId: null })} className="flex-1 py-8 font-black text-slate-400">CANCEL</button>
                            <button onClick={handleSaveSchedule} className="flex-[2] py-8 bg-blue-600 text-white rounded-[2.5rem] font-black text-2xl shadow-xl">CONFIRM</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
