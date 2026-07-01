// Test AniList API
async function main() {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: TRENDING_DESC) {
          id
          title { romaji english }
          coverImage { large medium }
          averageScore
          genres
          episodes
          status
          seasonYear
          season
          format
        }
      }
    }
  `;

  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { page: 1, perPage: 2 } })
  });

  console.log('STATUS:', res.status);
  const data = await res.json();
  console.log('DATA:', JSON.stringify(data, null, 2).substring(0, 800));
}

main().catch(e => console.log('ERROR:', e.message));
