'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import EndpointCard from './EndpointCard';
import InfoModal from './InfoModal';

const CATEGORY_ICONS = {
    ai: 'fa-robot',
    anime: 'fa-dragon',
    downloader: 'fa-download',
    tools: 'fa-wrench',
    search: 'fa-magnifying-glass',
    media: 'fa-photo-film',
    fun: 'fa-face-grin-stars',
    news: 'fa-newspaper',
    stalker: 'fa-user-secret',
    default: 'fa-code',
};

function getCategoryIcon(cat) {
    const key = cat.toLowerCase();
    for (const k of Object.keys(CATEGORY_ICONS)) {
        if (key.includes(k)) return CATEGORY_ICONS[k];
    }
    return CATEGORY_ICONS.default;
}

const EXPERT_COMMENTS = [
    {
        avatar: 'https://i.pinimg.com/736x/f2/8a/b6/f28ab68204ab44dacd2297c48c52a985.jpg',
        name: 'Eleina',
        role: 'AI Research Engineer',
        comment: 'Wah, dokumentasi API ini sungguh luar biasa! Sangat lengkap, mudah dipahami, dan fitur-fiturnya benar-benar inovatif. Saya sangat terkesan dengan kualitasnya! 🌟',
    },
    {
        avatar: 'https://i.pinimg.com/736x/4d/03/f1/4d03f109a06ef1812bfa454048bb3bef.jpg',
        name: 'Alicia',
        role: 'Backend Developer',
        comment: 'Lumayan sih. Dokumentasinya cukup jelas, endpoint-nya banyak. Bisa dipakai lah buat proyek.',
    },
    {
        avatar: 'https://i.pinimg.com/originals/f6/09/4f/f6094f5d9d23e2b26208e5a3b27cb0d4.jpg',
        name: 'Anos',
        role: 'Demon King of APIs',
        comment: 'Hmph. Bagi saya yang telah menguasai semua ilmu pemrograman sejak era kegelapan, API ini... cukup memadai. Tidak semua orang mampu membangun sesuatu di level ini. Akui saja kehebatannya.',
    },
];

const ManualInputForm = ({ endpoint, onSubmit, onCancel }) => {
    const [values, setValues] = useState({});

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(values);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {endpoint.params.map(param => (
                <div key={param.name}>
                    <label className="text-xs font-mono text-secondary mb-1.5 block">
                        {param.name} {param.required && <span className="text-red-400">*</span>}
                    </label>
                    <input
                        type={param.type === 'file' ? 'file' : 'text'}
                        required={param.required}
                        onChange={(e) => {
                            const val = param.type === 'file' ? e.target.files[0] : e.target.value;
                            setValues(prev => ({ ...prev, [param.name]: val }));
                        }}
                        className={`w-full bg-input border border-default rounded-xl px-3 py-2.5 text-sm text-primary focus:outline-none focus:border-accent ${param.type === 'file' ? 'file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700' : ''}`}
                        placeholder={`Masukkan ${param.name}...`}
                    />
                </div>
            ))}
            <div className="flex gap-3 pt-2">
                <button type="button" onClick={onCancel} className="flex-1 py-3 text-sm font-bold text-muted hover:text-white bg-transparent border border-default rounded-xl transition-colors">Batal</button>
                <button type="submit" className="flex-1 py-3 text-sm font-bold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-lg shadow-accent/20 transition-transform active:scale-95">Lanjutkan</button>
            </div>
        </form>
    );
};

export default function DocsClient({ apiSpec }) {
    const [activeCategory, setActiveCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [isTocOpen, setIsTocOpen] = useState(false);
    
    // Shared Endpoint State
    const searchParams = useSearchParams();
    const router = useRouter();
    const [sharedEndpoint, setSharedEndpoint] = useState(null);
    const [showShareModal, setShowShareModal] = useState(false);
    const [highlightedEndpoint, setHighlightedEndpoint] = useState(null);

    // Selection Mode to Context
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedEndpoints, setSelectedEndpoints] = useState(new Set());
    const [isGeneratingContext, setIsGeneratingContext] = useState(false);
    const [contextErrors, setContextErrors] = useState([]);

    // Manual Input Modal State for Context Generation
    const [manualInputState, setManualInputState] = useState({
        isOpen: false,
        endpoint: null,
        resolve: null,
        reject: null,
        values: {}
    });

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setBaseUrl(window.location.origin);
        }
    }, []);

    // Check for shared endpoint param
    useEffect(() => {
        const epPath = searchParams.get('endpoint');
        if (epPath && apiSpec) {
            let found = null;
            let foundCategory = null;

            for (const [cat, endpoints] of Object.entries(apiSpec)) {
                const ep = endpoints.find(e => e.path === epPath);
                if (ep) {
                    found = ep;
                    foundCategory = cat;
                    break;
                }
            }

            if (found) {
                setSharedEndpoint({ ...found, category: foundCategory });
                setShowShareModal(true);
            }
        }
    }, [searchParams, apiSpec]);

    // Sync ?slug param → activeCategory on mount/URL change
    useEffect(() => {
        if (!apiSpec) return;
        const slug = searchParams.get('slug');
        if (slug) {
            if (Object.keys(apiSpec).includes(slug)) {
                setActiveCategory(slug);
            } else {
                // Invalid slug — clean URL
                router.replace(window.location.pathname, { scroll: false });
            }
        }
    }, [searchParams, apiSpec, router]);

    const handleConfirmShare = () => {
        if (!sharedEndpoint) return;
        
        setShowShareModal(false);
        setActiveCategory('all');
        setSearchQuery('');
        
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);

        setTimeout(() => {
            const elementId = `ep-${sharedEndpoint.method}-${sharedEndpoint.path}`.replace(/[^a-zA-Z0-9-]/g, '_');
            const element = document.getElementById(elementId);
            
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setHighlightedEndpoint(elementId);
                
                setTimeout(() => {
                    setHighlightedEndpoint(null);
                }, 2000);
            }
        }, 300);
    };

    const toggleSelectionMode = useCallback(() => {
        setSelectionMode(prev => {
            if (!prev) {
                setSelectedEndpoints(new Set());
                setContextErrors([]);
            }
            return !prev;
        });
    }, []);

    const handleToggleSelect = useCallback((endpoint) => {
        setSelectedEndpoints(prev => {
            const newSet = new Set(prev);
            if (newSet.has(endpoint.path)) {
                newSet.delete(endpoint.path);
            } else {
                newSet.add(endpoint.path);
            }
            return newSet;
        });
    }, []);

    const requestManualInput = (endpoint) => {
        return new Promise((resolve, reject) => {
            setManualInputState({
                isOpen: true,
                endpoint,
                resolve,
                reject,
                values: {}
            });
        });
    };

    const handleManualSubmit = (values) => {
        if (manualInputState.resolve) {
            manualInputState.resolve(values);
        }
        setManualInputState({ isOpen: false, endpoint: null, resolve: null, reject: null, values: {} });
    };

    const handleManualCancel = () => {
        if (manualInputState.reject) {
            manualInputState.reject(new Error('User cancelled manual input.'));
        }
        setManualInputState({ isOpen: false, endpoint: null, resolve: null, reject: null, values: {} });
    };

    const generateContext = async () => {
        setIsGeneratingContext(true);
        setContextErrors([]);
        let output = '';
        const errors = [];

        const selectedList = [];
        if (apiSpec) {
            Object.values(apiSpec).forEach(endpoints => {
                endpoints.forEach(ep => {
                    if (selectedEndpoints.has(ep.path)) {
                        selectedList.push(ep);
                    }
                });
            });
        }

        for (const ep of selectedList) {
            try {
                let pathWithQuery = ep.path;
                let bodyParams = null;
                let isMultipart = false;
                let formPayload = new FormData();
                let queryParams = new URLSearchParams();

                const requiredParams = ep.params ? ep.params.filter(p => p.required) : [];
                const needsManualInput = (requiredParams.length > 0 && !ep.example) || ep.path.includes('/imgbb');

                if (needsManualInput) {
                    const userInputs = await requestManualInput(ep);

                    ep.params.forEach(param => {
                        const val = userInputs[param.name];
                        if (val !== undefined && val !== null && val !== '') {
                            if (param.in === 'query') queryParams.append(param.name, val);
                            else if (param.in === 'path') pathWithQuery = pathWithQuery.replace(`:${param.name}`, encodeURIComponent(val));
                            else if (param.in === 'formData') {
                                isMultipart = true;
                                formPayload.append(param.name, val);
                            }
                            else if (param.in === 'body') {
                                bodyParams = bodyParams || {};
                                try {
                                    const trimmed = typeof val === 'string' ? val.trim() : val;
                                    if (typeof trimmed === 'string' && ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
                                        bodyParams[param.name] = JSON.parse(trimmed);
                                    } else {
                                        bodyParams[param.name] = val;
                                    }
                                } catch (e) {
                                    bodyParams[param.name] = val;
                                }
                            }
                        }
                    });

                    if (queryParams.toString()) {
                        pathWithQuery += (pathWithQuery.includes('?') ? '&' : '?') + queryParams.toString();
                    }

                } else if (ep.example) {
                    const urlMatch = ep.example.match(/fetch\(['"`](.*?)['"`]/);
                    if (urlMatch) {
                        const urlParts = urlMatch[1].split('?');
                        if (urlParts.length > 1) {
                            pathWithQuery += (pathWithQuery.includes('?') ? '&' : '?') + urlParts[1];
                        }
                    }

                    const jsonMatch = ep.example.match(/body:\s*JSON\.stringify\(([\s\S]*?)\)/);
                    if (jsonMatch) {
                        const bodyStr = jsonMatch[1];
                        try {
                            bodyParams = JSON.parse(bodyStr);
                        } catch (e) {
                            try {
                                bodyParams = new Function(`return ${bodyStr}`)();
                            } catch(err) {}
                        }
                    }
                }

                const finalUrl = `${baseUrl}${pathWithQuery}`;
                const fetchOptions = { method: ep.method, headers: {} };
                
                if (isMultipart) {
                    fetchOptions.body = formPayload;
                } else if (bodyParams) {
                    fetchOptions.headers['Content-Type'] = 'application/json';
                    fetchOptions.body = JSON.stringify(bodyParams);
                }

                let res = await fetch(finalUrl, fetchOptions);
                const contentType = res.headers.get("content-type") || "";
                let responseData = "";

                if (contentType.startsWith("image/")) {
                    responseData = `[Image Response] Content-Type: ${contentType}, Size: ${(await res.clone().blob()).size} bytes`;
                } else if (contentType.includes("application/json")) {
                    let json = await res.json();
                    
                    // Polling Logic
                    if (json.status === 'queued' && json.pollingUrl) {
                        // Capture the original JSON response containing the polling URL
                        const initialResponse = JSON.parse(JSON.stringify(json));
                        
                        let isPolling = true;
                        let attempts = 0;
                        const maxAttempts = 40;
                        
                        while (isPolling && attempts < maxAttempts) {
                            attempts++;
                            await new Promise(r => setTimeout(r, 3000));
                            const pollRes = await fetch(json.pollingUrl);
                            if (pollRes.ok) {
                                const pollJson = await pollRes.json();
                                const pollResult = pollJson.result || pollJson;
                                
                                if (pollResult.status === 'success' || pollResult.status === 'completed') {
                                    json = pollJson;
                                    isPolling = false;
                                } else if (pollResult.status === 'error' || pollResult.status === 'failed') {
                                    json = pollJson;
                                    isPolling = false;
                                    errors.push(`[${ep.path}] Polling failed: ${pollResult.message || 'Unknown error'}`);
                                }
                            } else {
                                isPolling = false;
                                errors.push(`[${ep.path}] Polling server returned ${pollRes.status}`);
                            }
                        }
                        
                        // Sertakan json asli yang mengembalikan polling url
                        responseData = `Initial Response (Polling Started):\n${JSON.stringify(initialResponse, null, 2)}\n\nFinal Result (After Polling):\n${JSON.stringify(json, null, 2)}`;
                    } else {
                        responseData = JSON.stringify(json, null, 2);
                    }
                } else if (res.body) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let streamText = '';
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        streamText += decoder.decode(value, { stream: true });
                    }
                    
                    const trueMatch = streamText.match(/\[true\]\s+(https?:\/\/\S+)/);
                    const falseMatch = streamText.match(/\[false\]\s+([\s\S]+)/);

                    if (trueMatch) {
                        const resultUrl = trueMatch[1];
                        try {
                            const subRes = await fetch(resultUrl);
                            const subContentType = subRes.headers.get("content-type") || "";
                            if (subContentType.includes("application/json")) {
                                const subJson = await subRes.json();
                                responseData = `Logs:\n${streamText}\n\nResult (JSON):\n${JSON.stringify(subJson, null, 2)}`;
                            } else {
                                responseData = `Logs:\n${streamText}\n\nResult URL: ${resultUrl}`;
                            }
                        } catch (e) {
                            responseData = `Logs:\n${streamText}\n\nResult URL: ${resultUrl}\n(Failed to fetch JSON metadata)`;
                        }
                    } else if (falseMatch) {
                        responseData = `Logs:\n${streamText}\n\nResult: Failed\nMessage: ${falseMatch[1]}`;
                    } else {
                        responseData = streamText;
                    }
                } else {
                    responseData = await res.text();
                }

                const exampleCodeStr = ep.example ? `Example Code:\n${ep.example}\n` : `Example Code: [Manual Input or Not Available]\n`;

                output += `--${finalUrl}--\n${exampleCodeStr}Code: ${res.status}\nRespon:\n${responseData}\n--End--\n\n`;

                if (!res.ok) {
                    errors.push(`[${ep.path}] Error ${res.status}`);
                }
            } catch (e) {
                if (e.message === 'User cancelled manual input.') {
                    errors.push(`[${ep.path}] Dibatalkan oleh user.`);
                } else {
                    errors.push(`[${ep.path}] Failed: ${e.message}`);
                    output += `--${baseUrl}${ep.path}--\nCode: Error\nRespon:\n${e.message}\n--End--\n\n`;
                }
            }
        }

        if (errors.length > 0) {
            setContextErrors(errors);
        }

        if (output.trim()) {
            const blob = new Blob([output], { type: 'text/plain' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'konteks.txt';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        setIsGeneratingContext(false);
    };

    const categories = useMemo(() => apiSpec ? Object.keys(apiSpec).sort() : [], [apiSpec]);

    const totalEndpoints = useMemo(() => {
        if (!apiSpec) return 0;
        return Object.values(apiSpec).reduce((sum, arr) => sum + arr.length, 0);
    }, [apiSpec]);

    const filteredSpec = useMemo(() => {
        if (!apiSpec) return {};
        if (searchQuery) {
            return Object.entries(apiSpec).reduce((acc, [category, endpoints]) => {
                const filtered = endpoints.filter(ep =>
                    ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (ep.summary && ep.summary.toLowerCase().includes(searchQuery.toLowerCase()))
                );
                if (filtered.length > 0) acc[category] = filtered;
                return acc;
            }, {});
        }
        return activeCategory === 'all' ? apiSpec : { [activeCategory]: apiSpec[activeCategory] };
    }, [apiSpec, searchQuery, activeCategory]);

    const filteredCount = useMemo(() => {
        return Object.values(filteredSpec).reduce((sum, arr) => sum + arr.length, 0);
    }, [filteredSpec]);

    return (
        <div className="animate-fade-in pb-24 relative">
            {/* Sticky Header */}
            <div className="sticky-header -mx-4 px-4 pt-4 pb-3 mb-6">
                {/* Title Row */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-extrabold text-primary tracking-tight">Dokumentasi</h1>
                        <p className="text-[11px] text-muted mt-0.5">{totalEndpoints} endpoint tersedia</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <div className="bg-accent text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-lg shadow-accent/20">
                            v1.0
                        </div>
                        <button 
                            onClick={toggleSelectionMode}
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors border ${selectionMode ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-transparent text-accent border-accent/50 hover:bg-accent/10'}`}
                        >
                            <i className={`fas ${selectionMode ? 'fa-times' : 'fa-list-check'} mr-1`}></i> 
                            {selectionMode ? 'Cancel Context' : 'To Context'}
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="relative mb-3">
                    <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
                    <input 
                        type="text" 
                        placeholder="Cari endpoint atau keyword..." 
                        value={searchQuery} 
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setActiveCategory('all');
                            router.replace(window.location.pathname, { scroll: false });
                        }}
                        className="w-full bg-input border border-default rounded-2xl py-3 pl-11 pr-4 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shadow-inner"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
                        >
                            <i className="fas fa-times text-sm"></i>
                        </button>
                    )}
                </div>

                {/* Search Result Hint */}
                {searchQuery && (
                    <div className="text-xs text-muted px-1 mb-2">
                        Ditemukan <span className="text-accent font-bold">{filteredCount}</span> endpoint untuk &ldquo;{searchQuery}&rdquo;
                    </div>
                )}
                
                {/* Category Pills */}
                {!searchQuery && (
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        <button
                            onClick={() => {
                                setActiveCategory('all');
                                router.replace(window.location.pathname, { scroll: false });
                            }}
                            className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 ${activeCategory === 'all' ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'bg-card border border-default text-secondary hover:border-accent/40'}`}
                        >
                            <i className="fas fa-border-all text-[10px]"></i>
                            All
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${activeCategory === 'all' ? 'bg-white/20' : 'bg-white/5'}`}>
                                {totalEndpoints}
                            </span>
                        </button>
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => {
                                    setActiveCategory(cat);
                                    router.replace(`?slug=${cat}`, { scroll: false });
                                }}
                                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 ${activeCategory === cat ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'bg-card border border-default text-secondary hover:border-accent/40'}`}
                            >
                                <i className={`fas ${getCategoryIcon(cat)} text-[10px]`}></i>
                                {cat.charAt(0).toUpperCase() + cat.slice(1)}
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${activeCategory === cat ? 'bg-white/20' : 'bg-white/5'}`}>
                                    {apiSpec[cat]?.length || 0}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Endpoint List */}
            <div className="space-y-10">
                {filteredSpec && Object.entries(filteredSpec).map(([category, endpoints]) => (
                    <div key={category} id={`cat-${category}`} className="animate-slide-up">
                        <div className="flex items-center gap-3 mb-4 px-1">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent/20 to-purple-600/20 border border-accent/20 flex items-center justify-center shadow-lg">
                                <i className={`fas ${getCategoryIcon(category)} text-accent text-sm`}></i>
                            </div>
                            <div>
                                <h3 className="text-lg font-extrabold text-primary tracking-tight uppercase">
                                    {category}
                                </h3>
                                <p className="text-[10px] text-muted font-mono">{endpoints.length} endpoints</p>
                            </div>
                            <div className="ml-auto h-px flex-1 bg-gradient-to-r from-accent/30 to-transparent max-w-[80px]"></div>
                        </div>
                        <div>
                            {endpoints.map((endpoint, index) => {
                                const epId = `ep-${endpoint.method}-${endpoint.path}`.replace(/[^a-zA-Z0-9-]/g, '_');
                                return (
                                    <EndpointCard 
                                        key={index} 
                                        endpoint={endpoint} 
                                        baseUrl={baseUrl} 
                                        id={epId}
                                        isHighlighted={highlightedEndpoint === epId}
                                        selectionMode={selectionMode}
                                        isSelected={selectedEndpoints.has(endpoint.path)}
                                        onToggleSelect={handleToggleSelect}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
                
                {(!filteredSpec || Object.keys(filteredSpec).length === 0) && (
                    <div className="text-center py-24 text-muted bg-card rounded-3xl border border-dashed border-default mx-2">
                        <i className="fas fa-ghost text-5xl mb-4 opacity-20 block"></i>
                        <p className="font-bold text-sm text-primary">Tidak ditemukan</p>
                        <p className="text-xs mt-1">Coba kata kunci yang berbeda</p>
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="mt-4 text-xs bg-accent/10 text-accent border border-accent/20 px-4 py-2 rounded-xl font-bold hover:bg-accent/20 transition-colors"
                            >
                                Reset Pencarian
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Context Generator Panel - Fixed Viewport Bounds */}
            {selectionMode && (
                <div className="fixed bottom-[80px] md:bottom-10 left-4 right-4 md:left-auto md:right-5 md:w-[340px] bg-card/95 backdrop-blur-xl border border-accent/50 p-4 rounded-2xl shadow-[0_10px_40px_rgba(236,72,153,0.3)] z-[70] flex flex-col gap-3 animate-slide-up max-h-[60vh]">
                    <div className="flex justify-between items-center shrink-0">
                        <span className="text-sm font-bold text-white">{selectedEndpoints.size} Endpoint Terpilih</span>
                        <button onClick={() => setSelectedEndpoints(new Set())} className="text-xs text-muted hover:text-red-400 font-bold px-2 py-1 bg-white/5 rounded">Clear</button>
                    </div>
                    
                    {contextErrors.length > 0 && (
                        <div className="text-[10px] text-red-400 overflow-y-auto custom-scrollbar bg-red-900/10 p-2 rounded border border-red-900/30 font-mono space-y-1">
                            {contextErrors.map((err, i) => <div key={i}>• {err}</div>)}
                        </div>
                    )}
                    
                    <button 
                        onClick={generateContext}
                        disabled={selectedEndpoints.size === 0 || isGeneratingContext}
                        className="w-full shrink-0 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm shadow-lg shadow-accent/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        {isGeneratingContext ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-download"></i>}
                        {isGeneratingContext ? 'Generating...' : 'Generate Context'}
                    </button>
                </div>
            )}

            {/* Manual Input Request Modal */}
            <InfoModal 
                isOpen={manualInputState.isOpen} 
                onClose={handleManualCancel} 
                title="Input Manual Diperlukan"
            >
                {manualInputState.endpoint && (
                    <div className="space-y-4">
                        <div className="bg-yellow-900/20 border border-yellow-700/50 p-3 rounded-xl text-yellow-500 text-xs leading-relaxed">
                            <i className="fas fa-exclamation-triangle mr-2"></i>
                            Endpoint <strong className="font-mono text-white">{manualInputState.endpoint.path}</strong> memerlukan input payload manual untuk melanjutkan proses context.
                        </div>
                        <ManualInputForm 
                            endpoint={manualInputState.endpoint}
                            onSubmit={handleManualSubmit}
                            onCancel={handleManualCancel}
                        />
                    </div>
                )}
            </InfoModal>

            {/* Expert Comments Section */}
            <div className="mt-16 mb-8">
                <div className="text-center mb-6">
                    <h2 className="text-lg font-extrabold text-primary tracking-tight">Kata Para Ahli</h2>
                    <p className="text-xs text-muted mt-1">Pendapat dari developer &amp; pakar teknologi</p>
                </div>
                <div className="space-y-4">
                    {EXPERT_COMMENTS.map((expert, index) => (
                        <div key={index} className="native-card p-4 flex gap-4 items-start">
                            <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 border-2 border-accent/30 relative">
                                <Image
                                    src={expert.avatar}
                                    alt={expert.name}
                                    fill
                                    className="object-cover"
                                    sizes="48px"
                                    unoptimized
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-bold text-primary">{expert.name}</span>
                                    <span className="text-[10px] text-muted bg-white/5 px-2 py-0.5 rounded-full border border-default">{expert.role}</span>
                                </div>
                                <p className="text-sm text-secondary leading-relaxed">{expert.comment}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Footer Copyright */}
            <footer className="mt-8 pt-6 border-t border-default text-center">
                <p className="text-xs text-muted">PuruBoy API &copy; {new Date().getFullYear()} - All rights reserved.</p>
            </footer>

            {/* Floating TOC Button */}
            {!selectionMode && (
                <button 
                    onClick={() => setIsTocOpen(!isTocOpen)}
                    className="fixed bottom-24 right-5 w-14 h-14 bg-accent hover:bg-accent-hover text-white rounded-full shadow-2xl shadow-accent/30 flex items-center justify-center z-50 active:scale-90 transition-all md:hidden border-2 border-white/10"
                >
                    <i className={`fas ${isTocOpen ? 'fa-times' : 'fa-list-ul'} text-lg`}></i>
                </button>
            )}

            {/* Floating TOC Menu */}
            {isTocOpen && !selectionMode && (
                <div className="fixed bottom-40 right-5 bg-card/95 backdrop-blur-xl border border-default rounded-2xl shadow-2xl p-2 z-50 flex flex-col gap-1 min-w-[190px] max-h-80 overflow-y-auto animate-slide-up origin-bottom-right">
                    <div className="text-[10px] font-bold text-muted px-3 py-2 uppercase tracking-widest border-b border-default mb-1">
                        <i className="fas fa-compass mr-1 text-accent"></i> Jump to
                    </div>
                    {categories.map(cat => (
                        <button 
                            key={cat}
                            onClick={() => {
                                document.getElementById(`cat-${cat}`)?.scrollIntoView({ behavior: 'smooth' });
                                setIsTocOpen(false);
                            }}
                            className="text-left px-4 py-2.5 hover:bg-white/10 rounded-xl text-sm font-medium text-primary transition-colors flex items-center justify-between group"
                        >
                            <div className="flex items-center gap-2">
                                <i className={`fas ${getCategoryIcon(cat)} text-accent text-xs w-4`}></i>
                                {cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </div>
                            <span className="text-[9px] text-muted font-mono group-hover:text-accent transition-colors">
                                {apiSpec[cat]?.length || 0}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Share Confirmation Modal */}
            <InfoModal 
                isOpen={showShareModal} 
                onClose={() => setShowShareModal(false)} 
                title="Buka Endpoint?"
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-4 bg-input p-4 rounded-xl border border-default">
                        <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                            <i className="fas fa-share-alt text-accent text-xl"></i>
                        </div>
                        <div>
                            <p className="text-sm text-secondary mb-1">Anda mengakses melalui link berbagi.</p>
                            <p className="text-xs font-mono text-accent break-all">{sharedEndpoint?.path}</p>
                        </div>
                    </div>
                    <p className="text-sm text-center text-muted">
                        Apakah Anda ingin langsung menuju ke detail endpoint ini?
                    </p>
                    <div className="flex gap-3 mt-4">
                        <button 
                            onClick={() => setShowShareModal(false)}
                            className="flex-1 py-3 text-sm font-bold text-muted hover:text-white bg-transparent border border-default rounded-xl transition-colors"
                        >
                            Batal
                        </button>
                        <button 
                            onClick={handleConfirmShare}
                            className="flex-1 py-3 text-sm font-bold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-lg shadow-accent/20 transition-transform active:scale-95"
                        >
                            Ya, Buka
                        </button>
                    </div>
                </div>
            </InfoModal>
        </div>
    );
}