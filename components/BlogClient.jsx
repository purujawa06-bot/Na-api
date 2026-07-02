'use client';

import React, { useState, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import InfoModal from './InfoModal';
import BlogImage from './BlogImage';
import { Virtuoso } from 'react-virtuoso';

const getTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " tahun lalu";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " bulan lalu";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " hari lalu";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " jam lalu";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " menit lalu";
    return "Baru saja";
};

const extractTitle = (content, excerpt) => {
    if (!content) return excerpt ? excerpt.split(' ').slice(0, 8).join(' ') : 'No Title';
    
    const match = content.match(/^#+\s+(.*)$/m);
    if (match) return match[1];
    
    if (!excerpt) return 'No Content';
    const words = excerpt.split(' ');
    return words.slice(0, 8).join(' ') + (words.length > 8 ? '...' : '');
};

// Memoized Card Component to prevent unnecessary re-renders
const BlogCard = memo(({ post, onClick }) => {
    const displayTitle = extractTitle(post.content, post.excerpt);
    const timeAgo = getTimeAgo(post.createdAt);

    return (
        <article 
            onClick={() => onClick(post)}
            className="native-card group cursor-pointer overflow-hidden relative rounded-2xl h-full"
        >
            {post.image ? (
                <div className="relative h-48 w-full overflow-hidden">
                    <BlogImage 
                        src={post.image} 
                        alt="Cover" 
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-110"
                        sizes="(max-width: 768px) 100vw, 50vw"
                        priority={false}
                        containerClassName="absolute inset-0"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
                    <div className="absolute bottom-3 left-4 right-4 flex justify-between items-end">
                        <span className="bg-accent/90 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide shadow-lg">
                            {post.tag}
                        </span>
                    </div>
                </div>
            ) : (
                <div className="h-2 bg-gradient-to-r from-accent to-purple-600"></div>
            )}
            
            <div className="p-5">
                <div className="flex items-center gap-2 text-xs text-muted mb-2">
                    <i className="far fa-clock"></i>
                    <span>{timeAgo}</span>
                    {!post.image && (
                        <>
                            <span className="mx-1">•</span>
                            <span className="text-accent font-bold">{post.tag}</span>
                        </>
                    )}
                </div>

                <h2 className="text-lg font-bold text-primary mb-2 leading-tight group-hover:text-accent transition-colors">
                    {displayTitle}
                </h2>
                
                <p className="text-sm text-secondary line-clamp-2 leading-relaxed mb-4">
                    {post.excerpt}
                </p>

                <div className="flex items-center text-xs font-bold text-accent">
                    Baca Selengkapnya <i className="fas fa-arrow-right ml-2 transition-transform group-hover:translate-x-1"></i>
                </div>
            </div>
        </article>
    );
});

BlogCard.displayName = 'BlogCard';

export default function BlogClient({ initialPosts, totalPages: initialTotalPages }) {
    const [posts, setPosts] = useState(initialPosts);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(page < initialTotalPages);
    const [loadingMore, setLoadingMore] = useState(false);

    const [selectedPost, setSelectedPost] = useState(null);
    const [isLoadingPost, setIsLoadingPost] = useState(false);

    // Fetch more posts when page increments
    useEffect(() => {
        if (page === 1) return;

        const loadMorePosts = async () => {
            setLoadingMore(true);
            try {
                const res = await fetch(`/api/blogs?page=${page}&limit=5`);
                const data = await res.json();
                
                setPosts(prevPosts => [...prevPosts, ...data.posts]);
                setHasMore(data.currentPage < data.totalPages);
            } catch (err) {
                console.error("Error fetching posts:", err);
            } finally {
                setLoadingMore(false);
            }
        };

        loadMorePosts();
    }, [page]);

    const handlePostClick = useCallback(async (postPreview) => {
        setSelectedPost(postPreview);
        setIsLoadingPost(true);

        try {
            const res = await fetch(`/api/blogs/${postPreview.id}`);
            if (res.ok) {
                const fullPost = await res.json();
                setSelectedPost(fullPost);
            }
        } catch (error) {
            console.error("Failed to load full post:", error);
        } finally {
            setIsLoadingPost(false);
        }
    }, []);

    const loadMore = useCallback(() => {
        if (loadingMore || !hasMore) return;
        setPage(p => p + 1);
    }, [loadingMore, hasMore]);

    // Optimize list rendering using Virtuoso (Virtual DOM)
    // Only renders items currently in viewport to save RAM
    return (
        <>
            {posts.length > 0 ? (
                <Virtuoso
                    useWindowScroll
                    data={posts}
                    endReached={loadMore}
                    itemContent={(index, post) => (
                        <div className="pb-6">
                            <BlogCard post={post} onClick={handlePostClick} />
                        </div>
                    )}
                    components={{
                        Footer: () => (
                            <div className="py-4">
                                {loadingMore && (
                                    <div className="flex justify-center items-center">
                                        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                )}
                                {!hasMore && posts.length > 0 && (
                                    <div className="text-center py-4">
                                        <span className="text-xs text-muted bg-card px-3 py-1 rounded-full border border-default">
                                            — You&apos;ve reached the end —
                                        </span>
                                    </div>
                                )}
                            </div>
                        )
                    }}
                />
            ) : (
                 <div className="text-center py-20 text-muted flex flex-col items-center">
                    <i className="far fa-folder-open text-4xl mb-3 opacity-50"></i>
                    <p>Belum ada postingan.</p>
                </div>
            )}

            <InfoModal 
                isOpen={!!selectedPost} 
                onClose={() => setSelectedPost(null)} 
                title={selectedPost ? selectedPost.tag : 'Detail Post'}
            >
                {selectedPost && (
                    <div className="prose-styles relative">
                        {isLoadingPost && (
                            <div className="absolute top-0 right-0 p-2 z-10">
                                <i className="fas fa-circle-notch fa-spin text-accent"></i>
                            </div>
                        )}

                        {selectedPost.image && (
                            <div className="relative w-full h-64 mb-6 rounded-2xl overflow-hidden shadow-lg">
                                <BlogImage 
                                    src={selectedPost.image} 
                                    alt="Cover" 
                                    fill
                                    className="object-cover"
                                    priority
                                    containerClassName="absolute inset-0"
                                />
                            </div>
                        )}
                        <h2 className="text-2xl font-bold text-primary mb-2">
                            {extractTitle(selectedPost.content, selectedPost.excerpt)}
                        </h2>
                        <div className="flex items-center gap-3 text-xs text-muted mb-6 border-b border-default pb-4">
                             <span className="bg-input px-2 py-1 rounded border border-default">
                                <i className="far fa-calendar-alt mr-1"></i> 
                                {new Date(selectedPost.createdAt).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
                             </span>
                             <span className="bg-input px-2 py-1 rounded border border-default">
                                <i className="far fa-clock mr-1"></i> 
                                {getTimeAgo(selectedPost.createdAt)}
                             </span>
                        </div>
                        
                        <div className={`transition-opacity duration-300 ${isLoadingPost ? 'opacity-50' : 'opacity-100'}`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {selectedPost.content}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}
            </InfoModal>
        </>
    );
}