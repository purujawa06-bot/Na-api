'use client';
import React, { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react';
import Image from 'next/image';
import MethodBadge from './MethodBadge';
import CopyButton from './CopyButton';
import InfoModal from './InfoModal';

const EndpointCard = memo(function EndpointCard({ endpoint, baseUrl, id, isHighlighted, onExpand, selectionMode, isSelected, onToggleSelect }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('params'); 
    const [isLoading, setIsLoading] = useState(false);
    const [finalData, setFinalData] = useState(null);
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    const [codeFormat, setCodeFormat] = useState('js'); // State untuk tab Example (js/curl)
    const [formValues, setFormValues] = useState({});
    
    const formRef = useRef(null);
    const fullUrl = `${baseUrl}${endpoint.path}`;
    const hasAutoFill = !!endpoint.example;
    const hasGuide = !!endpoint.guide;
    const isGuideEndpoint = hasGuide && endpoint.params.length === 0 && !endpoint.example;

    useEffect(() => {
        if (isHighlighted) {
            setIsOpen(true);
        }
    }, [isHighlighted]);

    const autoFill = useCallback(() => {
        if (!hasAutoFill) return;
        try {
            const jsonMatch = endpoint.example.match(/body:\s*JSON\.stringify\(([\s\S]*?)\)/);
            if (jsonMatch) {
                const bodyStr = jsonMatch[1];
                let parsedBody = {};

                try {
                    parsedBody = JSON.parse(bodyStr);
                } catch (e) {
                    try {
                        parsedBody = new Function(`return ${bodyStr}`)();
                    } catch (evalErr) {}
                }

                const processedValues = {};
                Object.keys(parsedBody).forEach(key => {
                    const val = parsedBody[key];
                    if (typeof val === 'object' && val !== null) {
                        processedValues[key] = JSON.stringify(val);
                    } else {
                        processedValues[key] = val;
                    }
                });

                // Auto-fill default choice values
            endpoint.params.forEach(p => {
                if (p.choices && p.choices.length > 0 && !processedValues[p.name]) {
                    processedValues[p.name] = p.choices[0].value;
                }
            });

            setFormValues(prev => ({ ...prev, ...processedValues }));
            }
            
            const urlMatch = endpoint.example.match(/fetch\(['"`](.*?)['"`]/);
            if (urlMatch) {
                const urlParts = urlMatch[1].split('?');
                if (urlParts.length > 1) {
                    const params = new URLSearchParams(urlParts[1]);
                    for (const [key, val] of params) {
                        setFormValues(prev => ({ ...prev, [key]: val }));
                    }
                }
                
                const bodyMatch = endpoint.example.match(/body:\s*JSON\.stringify\(([\s\S]*?)\)/);
                if (!bodyMatch) {
                    try {
                        const rawBody = endpoint.example.split('body: ')[1]?.split(',\n')[0];
                        if (rawBody) {
                            const parsedRaw = JSON.parse(rawBody);
                            setFormValues(prev => ({ ...prev, ...parsedRaw }));
                        }
                    } catch (e) {}
                }
            }
        } catch (error) {
            console.warn("Auto-fill failed: EndpointCard");
        }
    }, [endpoint.example, hasAutoFill]);

    useEffect(() => {
        if (isOpen && hasAutoFill) {
            autoFill();
        }
    }, [isOpen, autoFill, hasAutoFill]);

    const handleTryItOut = async (e) => {
        e.preventDefault();
        // Revoke previous blob URL to prevent memory leak
        if (finalData?.isImage && finalData?.data) {
            URL.revokeObjectURL(finalData.data);
        }
        setFinalData(null);
        setActiveTab('response');
        setIsLoading(true);

        const formData = new FormData(formRef.current);
        const queryParams = new URLSearchParams();
        const bodyParams = {};
        const formPayload = new FormData(); 
        let isMultipart = false;
        let path = endpoint.path;

        endpoint.params.forEach(param => {
            const value = formValues[param.name] !== undefined && formValues[param.name] !== ''
                ? formValues[param.name]
                : formData.get(param.name);
            if (value) {
                if (param.in === 'query') queryParams.append(param.name, value);
                else if (param.in === 'formData') {
                    isMultipart = true;
                    formPayload.append(param.name, value); 
                }
                else if (param.in === 'body') {
                    try {
                        const trimmed = typeof value === 'string' ? value.trim() : value;
                        if (typeof trimmed === 'string' && ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
                            (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
                            bodyParams[param.name] = JSON.parse(trimmed);
                        } else {
                            bodyParams[param.name] = value;
                        }
                    } catch (e) {
                        bodyParams[param.name] = value;
                    }
                }
                else if (param.in === 'path') path = path.replace(`:${param.name}`, encodeURIComponent(value));
            }
        });

        const fetchOptions = { method: endpoint.method, headers: {} };
        
        if (isMultipart) {
            fetchOptions.body = formPayload;
        } else if (Object.keys(bodyParams).length > 0) {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(bodyParams);
        }
        
        const finalUrl = `${baseUrl}${path}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

        try {
            const res = await fetch(finalUrl, fetchOptions);
            const contentType = res.headers.get("content-type") || "";

            if (contentType.startsWith("image/")) {
                const blob = await res.blob();
                const imageUrl = URL.createObjectURL(blob);
                setIsLoading(false);
                setFinalData({
                    ok: res.ok,
                    status: res.status,
                    data: imageUrl,
                    isImage: true
                });
                return;
            }

            if (contentType.includes("application/json")) {
                const json = await res.json();
                setIsLoading(false);
                setFinalData({ 
                    ok: res.ok, 
                    status: res.status, 
                    data: JSON.stringify(json, null, 2),
                    isStream: false 
                });
            } 
            else if (res.body) {
                setIsLoading(false); 
                setFinalData({ 
                    ok: res.ok, 
                    status: res.status, 
                    data: "", 
                    isStream: true 
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    
                    setFinalData(prev => ({
                        ...prev,
                        data: (prev?.data || "") + chunk
                    }));
                }
            } else {
                const text = await res.text();
                setIsLoading(false);
                setFinalData({ ok: res.ok, status: res.status, data: text, isStream: false });
            }
        } catch (error) {
            setIsLoading(false);
            setFinalData({ ok: false, status: 'Error', data: error.message, isStream: false });
        }
    };
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormValues(prev => ({ ...prev, [name]: value }));
    };

    const getGeneratedCurl = () => {
        let path = endpoint.path;
        const queryParams = new URLSearchParams();
        const bodyParams = {};
        let isMultipart = false;

        let defaultValues = {};
        if (endpoint.example) {
            const jsonMatch = endpoint.example.match(/body:\s*JSON\.stringify\(([\s\S]*?)\)/);
            if (jsonMatch) {
                try { defaultValues = new Function(`return ${jsonMatch[1]}`)() || {}; } catch(e) {}
            }
            const urlMatch = endpoint.example.match(/fetch\(['"`](.*?)['"`]/);
            if (urlMatch) {
                const urlParts = urlMatch[1].split('?');
                if (urlParts.length > 1) {
                    const params = new URLSearchParams(urlParts[1]);
                    params.forEach((val, key) => { defaultValues[key] = val; });
                }
            }
        }

        endpoint.params.forEach(param => {
            let val = formValues[param.name];
            if (val === undefined || val === '') val = defaultValues[param.name];
            
            if (param.in === 'query') {
                if (val !== undefined && val !== '') {
                    queryParams.append(param.name, val);
                } else if (param.required) {
                    queryParams.append(param.name, `<${param.name}>`);
                }
            } else if (param.in === 'path') {
                path = path.replace(`:${param.name}`, (val !== undefined && val !== '') ? encodeURIComponent(val) : `<${param.name}>`);
            } else if (param.in === 'formData') {
                isMultipart = true;
            } else if (param.in === 'body') {
                if (val !== undefined && val !== '') {
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
                } else if (param.required) {
                    bodyParams[param.name] = `<${param.name}>`;
                }
            }
        });

        if (Object.keys(bodyParams).length === 0 && endpoint.example && ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            Object.keys(defaultValues).forEach(k => {
                if (!queryParams.has(k) && !path.includes(k) && !isMultipart) {
                    bodyParams[k] = defaultValues[k];
                }
            });
        }

        const queryString = queryParams.toString();
        const finalUrl = `${baseUrl}${path}${queryString ? '?' + decodeURIComponent(queryString) : ''}`;
        
        let curl = `curl -X ${endpoint.method} "${finalUrl}"`;

        if (isMultipart) {
             endpoint.params.filter(p => p.in === 'formData').forEach(p => {
                 let val = formValues[p.name];
                 if (val === undefined || val === '') val = defaultValues[p.name];

                 if (p.type === 'file') {
                     let displayVal = '<path_to_file>';
                     if (val) displayVal = val.replace(/C:\\fakepath\\/i, '');
                     curl += ` \\\n  -F "${p.name}=@${displayVal}"`;
                 } else {
                     curl += ` \\\n  -F "${p.name}=${val || `<${p.name}>`}"`;
                 }
             });
        } else if (Object.keys(bodyParams).length > 0) {
             curl += ` \\\n  -H "Content-Type: application/json"`;
             curl += ` \\\n  -d '${JSON.stringify(bodyParams, null, 2)}'`;
        }

        return curl;
    };

    useEffect(() => {
        if (isOpen && window.hljs) {
            if (activeTab === 'example' || (activeTab === 'response' && finalData?.data && !finalData.isStream)) {
                setTimeout(() => {
                    document.querySelectorAll('pre code').forEach((block) => {
                        delete block.dataset.highlighted;
                        window.hljs.highlightElement(block);
                    });
                }, 10);
            }
        }
    }, [isOpen, activeTab, codeFormat, finalData?.data, finalData?.isStream, formValues]);

    const shareUrl = typeof window !== 'undefined' 
        ? `${window.location.origin}/docs?endpoint=${encodeURIComponent(endpoint.path)}`
        : '';

    return (
        <>
            <div 
                id={id} 
                className={`native-card mb-4 overflow-hidden rounded-2xl transition-all duration-500 ${isHighlighted ? 'ring-2 ring-accent shadow-[0_0_20px_rgba(236,72,153,0.3)] bg-accent/5' : ''}`}
            >
                <div 
                    onClick={() => setIsOpen(!isOpen)}
                    className="p-4 flex items-center justify-between cursor-pointer active:bg-white/5 transition-colors"
                >
                    <div className="flex items-center gap-3 overflow-hidden">
                        {selectionMode && (
                            <div 
                                onClick={(e) => { e.stopPropagation(); onToggleSelect(endpoint); }} 
                                className="mr-1 flex items-center justify-center shrink-0"
                            >
                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-accent border-accent' : 'border-default bg-input hover:border-accent'}`}>
                                    {isSelected && <i className="fas fa-check text-white text-[10px]"></i>}
                                </div>
                            </div>
                        )}
                        <MethodBadge method={endpoint.method} />
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-mono text-accent truncate">{endpoint.path}</span>
                            <span className="text-sm text-primary font-medium truncate">{endpoint.title || endpoint.summary}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 ml-2">
                        {isOpen && (
                            <>
                                <div 
                                    onClick={(e) => { e.stopPropagation(); }}
                                    className="group/share relative w-8 h-8 flex items-center justify-center rounded-full bg-input text-muted hover:text-white transition-colors animate-fade-in"
                                >
                                    <CopyButton textToCopy={shareUrl} iconOnly />
                                </div>

                                {endpoint.description && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); setIsInfoOpen(true); }}
                                        className="w-8 h-8 flex items-center justify-center rounded-full bg-input text-muted hover:text-white transition-colors animate-fade-in"
                                    >
                                        <i className="fas fa-info text-xs"></i>
                                    </button>
                                )}
                            </>
                        )}
                        <i className={`fas fa-chevron-down text-muted transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}></i>
                    </div>
                </div>

                <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                        <div className="border-t border-default">
                            {isGuideEndpoint ? null : (
                            <div className="flex border-b border-default bg-black/10">
                                {['params', 'example', 'response'].map(tab => (
                                    <button 
                                        key={tab}
                                        onClick={() => setActiveTab(tab)} 
                                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-all 
                                            ${activeTab === tab 
                                                ? 'text-accent border-b-2 border-accent bg-accent/5' 
                                                : 'text-muted hover:text-secondary'}`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                            )}

                            <div className="p-5 bg-black/20">
                                {isGuideEndpoint ? (
                                    <div className="animate-fade-in">
                                        <div className="prose prose-invert max-w-none">
                                            <div className="relative group">
                                                <pre className="bg-code p-4 rounded-xl overflow-x-auto text-xs border border-default custom-scrollbar shadow-inner whitespace-pre-wrap">
                                                    <code className="language-markdown font-mono">{endpoint.guide}</code>
                                                </pre>
                                                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <CopyButton textToCopy={endpoint.guide} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                <>
                                {activeTab === 'params' && (
                                    <div className="animate-fade-in">
                                        <form ref={formRef} onSubmit={handleTryItOut}>
                                            {hasAutoFill && (
                                                <div className="flex justify-end mb-4">
                                                    <button 
                                                        type="button" 
                                                        onClick={autoFill}
                                                        className="text-xs bg-accent/10 text-accent hover:bg-accent/20 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-2"
                                                    >
                                                        <i className="fas fa-magic"></i> Auto Fill
                                                    </button>
                                                </div>
                                            )}
                                            
                                            {endpoint.params.length > 0 ? (
                                                <div className="space-y-4">
                                                    {endpoint.params.map(param => (
                                                        <div key={param.name} className="group">
                                                            <div className="flex justify-between items-center mb-1.5">
                                                                <label className="text-xs font-mono text-secondary group-focus-within:text-accent transition-colors">
                                                                    {param.name}
                                                                </label>
                                                                <div className="flex gap-2">
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 uppercase">{param.in}</span>
                                                                    {param.required ? (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 font-bold uppercase">Required</span>
                                                                    ) : (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 uppercase">Optional</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            
                                                            {param.description && (
                                                                <p className="text-[10px] text-gray-500 mb-2 leading-relaxed break-words">{param.description}</p>
                                                            )}

                                                            <div className="relative">
                                                                {param.choices ? (
                                                                    <div className="flex gap-3 p-1 bg-input rounded-xl border border-default">
                                                                        {param.choices.map(choice => {
                                                                            const isSelected = (formValues[param.name] || choice.value) === choice.value;
                                                                            return (
                                                                                <button
                                                                                    key={choice.value}
                                                                                    type="button"
                                                                                    name={param.name}
                                                                                    onClick={() => handleInputChange({ target: { name: param.name, value: choice.value } })}
                                                                                    className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${
                                                                                        isSelected
                                                                                            ? 'bg-accent text-white shadow-lg shadow-accent/20'
                                                                                            : 'text-muted hover:text-white hover:bg-white/5'
                                                                                    }`}
                                                                                >
                                                                                    {choice.label}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                ) : (
                                                                <>
                                                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-accent transition-colors">
                                                                    <i className={`fas ${param.in === 'query' ? 'fa-search' : (param.in === 'body' || param.in === 'formData') ? (param.type === 'file' ? 'fa-upload' : 'fa-code') : 'fa-link'} text-xs`}></i>
                                                                </div>
                                                                <input
                                                                    name={param.name}
                                                                    type={param.type === 'file' ? 'file' : 'text'}
                                                                    placeholder={`Enter ${param.name}...`}
                                                                    {...(param.type !== 'file' ? { 
                                                                        value: formValues[param.name] || '', 
                                                                        onChange: handleInputChange 
                                                                    } : {})}
                                                                    className={`w-full bg-input border border-default rounded-xl pl-9 pr-3 py-2.5 text-sm text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all placeholder-gray-700 ${param.type === 'file' ? 'file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700' : ''}`}
                                                                    required={param.required}
                                                                    accept={param.type === 'file' ? 'image/*' : undefined}
                                                                />
                                                                </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-center py-6 bg-input/50 rounded-xl border border-dashed border-default">
                                                    <p className="text-sm text-muted">Tidak ada parameter yang diperlukan.</p>
                                                </div>
                                            )}
                                            
                                            <button 
                                                type="submit" 
                                                disabled={isLoading}
                                                className="mt-6 w-full bg-accent hover:bg-accent-hover text-white font-bold py-3 rounded-xl text-sm shadow-lg shadow-accent/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                                            >
                                                {isLoading ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-play"></i>}
                                                {isLoading ? 'Processing...' : 'Test Endpoint'}
                                            </button>
                                        </form>
                                    </div>
                                )}

                                {activeTab === 'example' && (
                                    <div className="animate-fade-in">
                                        <div className="flex justify-end mb-3 gap-2">
                                            <button 
                                                type="button" 
                                                onClick={() => setCodeFormat('js')}
                                                className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm ${codeFormat === 'js' ? 'bg-accent text-white shadow-accent/20' : 'bg-input border border-default text-gray-400 hover:text-white hover:border-accent/50'}`}
                                            >
                                                <i className="fab fa-js mr-1"></i> Fetch (JS)
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => setCodeFormat('curl')}
                                                className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm ${codeFormat === 'curl' ? 'bg-accent text-white shadow-accent/20' : 'bg-input border border-default text-gray-400 hover:text-white hover:border-accent/50'}`}
                                            >
                                                <i className="fas fa-terminal mr-1"></i> cURL
                                            </button>
                                        </div>

                                        {codeFormat === 'js' ? (
                                            <div className="relative group">
                                                <pre className="bg-code p-4 rounded-xl overflow-x-auto text-xs border border-default custom-scrollbar shadow-inner">
                                                    <code className="language-javascript font-mono">
                                                        {endpoint.example ? endpoint.example.replace(/fetch\(['"](.*?)['"]/g, `fetch('${baseUrl}$1'`) : '// Tidak ada contoh tersedia'}
                                                    </code>
                                                </pre>
                                                {endpoint.example && (
                                                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <CopyButton textToCopy={endpoint.example.replace(/fetch\(['"](.*?)['"]/g, `fetch('${baseUrl}$1'`)} />
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="relative group">
                                                <pre className="bg-code p-4 rounded-xl overflow-x-auto text-xs border border-default custom-scrollbar shadow-inner">
                                                    <code className="language-bash font-mono whitespace-pre-wrap break-all">
                                                        {getGeneratedCurl()}
                                                    </code>
                                                </pre>
                                                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <CopyButton textToCopy={getGeneratedCurl()} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'response' && (
                                    <div className="animate-fade-in min-h-[150px]">
                                        {!finalData && !isLoading && (
                                            <div className="flex flex-col items-center justify-center h-full py-8 text-muted space-y-2">
                                                <i className="fas fa-terminal text-2xl mb-2 opacity-50"></i>
                                                <p className="text-xs">Tekan &ldquo;Test Endpoint&rdquo; untuk melihat hasil.</p>
                                            </div>
                                        )}
                                        
                                        {isLoading && (
                                            <div className="flex flex-col items-center justify-center py-10">
                                                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3"></div>
                                                <p className="text-xs text-accent animate-pulse">Menghubungi server...</p>
                                            </div>
                                        )}

                                        {finalData && (
                                            <div className="relative">
                                                <div className={`flex justify-between items-center mb-2 px-1`}>
                                                    <span className={`text-xs font-bold px-2 py-1 rounded ${finalData.ok ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                                                        {finalData.status} {finalData.ok ? 'OK' : 'Error'}
                                                        {finalData.isImage && <span className="ml-2 text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">IMAGE</span>}
                                                        {finalData.isStream && <span className="ml-2 text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded animate-pulse">STREAMING</span>}
                                                    </span>
                                                    {!finalData.isImage && <CopyButton textToCopy={finalData.data} />}
                                                </div>
                                                {finalData.isImage ? (
                                                    <div className="flex justify-center p-4 bg-input/50 rounded-xl border border-default">
                                                        <Image src={finalData.data} alt="Response Image" className="max-w-full max-h-[400px] rounded-lg object-contain" width={400} height={400} unoptimized />
                                                    </div>
                                                ) : (
                                                <pre className="bg-code p-4 rounded-xl overflow-x-auto max-h-[400px] text-xs border border-default custom-scrollbar shadow-inner">
                                                    <code className={`language-${finalData.isStream ? 'text' : (finalData.ok ? 'json' : 'text')} font-mono`}>
                                                        {finalData.data}
                                                    </code>
                                                </pre>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                                </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <InfoModal isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} title="Detail Endpoint">
                <div className="space-y-6">
                    <div>
                        <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Summary</h4>
                        <p className="text-sm text-primary font-medium leading-relaxed">{endpoint.summary || 'Tidak ada ringkasan.'}</p>
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Deskripsi</h4>
                        <div className="text-secondary text-sm leading-relaxed bg-input p-4 rounded-xl border border-default" dangerouslySetInnerHTML={{ __html: endpoint.description || 'Tidak ada deskripsi.' }} />
                    </div>
                    <div>
                        <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-2">URL Endpoint</h4>
                        <div className="bg-black/50 p-3 rounded-xl border border-default flex items-center justify-between gap-2">
                            <code className="text-xs font-mono text-accent break-all line-clamp-2">{fullUrl}</code>
                            <CopyButton textToCopy={fullUrl} />
                        </div>
                    </div>
                </div>
            </InfoModal>
        </>
    );
    });

    export default EndpointCard;