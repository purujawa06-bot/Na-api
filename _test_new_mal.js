// Test the new MAL scraper
const jikan = require('./lib/jikan');

async function main() {
    try {
        console.log('=== TOP ANIME ===');
        const top = await jikan.getTopAnime(1, 3);
        console.log(JSON.stringify(top, null, 2).substring(0, 600));
        console.log('...');
        console.log('Items:', top.data?.length, '| Has next:', top.pagination?.has_next_page);
    } catch(e) { console.log('Top error:', e.message); }

    try {
        console.log('\n=== SEARCH ===');
        const search = await jikan.searchAnime('Naruto', 1, 2);
        console.log(JSON.stringify(search, null, 2).substring(0, 600));
        console.log('...');
        console.log('Items:', search.data?.length);
    } catch(e) { console.log('Search error:', e.message); }

    try {
        console.log('\n=== SEASONAL ===');
        const seasonal = await jikan.getSeasonNow(1, 2);
        console.log(JSON.stringify(seasonal, null, 2).substring(0, 600));
        console.log('...');
        console.log('Items:', seasonal.data?.length);
    } catch(e) { console.log('Seasonal error:', e.message); }

    try {
        console.log('\n=== GENRE (Action=1) ===');
        const genre = await jikan.getAnimeByGenre(1, 1, 2);
        console.log(JSON.stringify(genre, null, 2).substring(0, 600));
        console.log('...');
        console.log('Items:', genre.data?.length);
    } catch(e) { console.log('Genre error:', e.message); }
}

main().catch(e => console.log('FATAL:', e.message));
