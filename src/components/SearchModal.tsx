'use client';

import React, { useState, useEffect } from 'react';
import { Search, X, MessageSquare, ChevronRight } from 'lucide-react';

interface SearchResult {
  conversation_id: string;
  title: string;
  snippet: string | null;
  started_at: string;
}

interface SessionSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSelectSession: (id: string) => void;
}

export function SessionSearchModal({ isOpen, onClose, userId, onSelectSession }: SessionSearchModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/conversations/search?userId=${userId}&q=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();
        setResults(data.results || []);
      } catch (err) {
        console.error('Failed to search sessions', err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchTerm, userId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const renderSnippet = (text: string | null, query: string) => {
    if (!text) return null;
    const matchIndex = text.toLowerCase().indexOf(query.toLowerCase());
    if (matchIndex === -1) return text.slice(0, 90) + '...';

    const start = Math.max(0, matchIndex - 25);
    const end = Math.min(text.length, matchIndex + query.length + 45);
    const excerpt = text.slice(start, end);
    const parts = excerpt.split(new RegExp(`(${query})`, 'gi'));

    return (
      <span>
        {start > 0 && '...'}
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <span key={i} className="font-semibold text-foreground underline decoration-[#a3785e]">
              {part}
            </span>
          ) : (
            part
          )
        )}
        {end < text.length && '...'}
      </span>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm fade-in"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-xl bg-background border border-border/50 rounded-2xl shadow-2xl overflow-hidden mx-4 fade-in-scale"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-border/40 gap-3">
          <Search className="w-4 h-4 text-[#a3785e]/70 shrink-0" />
          <input
            type="text"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
            placeholder="Search your past sessions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')} 
              className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results Container */}
        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {loading && (
            <div className="py-8 text-center text-xs text-muted-foreground/50">Searching sessions...</div>
          )}

          {!loading && results.length === 0 && searchTerm && (
            <div className="py-8 text-center text-xs text-muted-foreground/50">No matching text found in sessions</div>
          )}

          {!loading && !searchTerm && (
            <div className="py-8 text-center text-xs text-muted-foreground/40">
              Type to search across session topics and spoken messages
            </div>
          )}

          {!loading &&
            results.map((item) => (
              <button
                key={item.conversation_id}
                onClick={() => {
                  onSelectSession(item.conversation_id);
                  onClose();
                }}
                className="w-full text-left p-3.5 rounded-xl hover:bg-[#a3785e]/5 border border-transparent hover:border-[#a3785e]/15 transition-all group flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-[#a3785e]/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-4 h-4 text-[#a3785e]/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[13px] font-medium text-foreground/90 truncate">{item.title}</span>
                    <span className="text-[10px] text-muted-foreground/40 font-mono ml-2 shrink-0">
                      {new Date(item.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  {item.snippet && (
                    <p className="text-[11px] text-muted-foreground/60 line-clamp-2 leading-relaxed">
                      {renderSnippet(item.snippet, searchTerm)}
                    </p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-[#a3785e]/60 shrink-0 transition-colors" />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}