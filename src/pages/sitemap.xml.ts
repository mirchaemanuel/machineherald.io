import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '@/lib/seo';
import { filterPublished } from '@/lib/utils';

export const GET: APIRoute = async () => {
  const articles = await getCollection('articles');
  const publishedArticles = filterPublished(articles);

  // Static pages
  const staticPages = [
    '',
    '/briefings',
    '/analysis',
    '/news',
    '/about',
    '/provenance',
  ];

  // Generate sitemap XML
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${staticPages
    .map(
      (page) => `
  <url>
    <loc>${SITE.url}${page}</loc>
    <changefreq>weekly</changefreq>
    <priority>${page === '' ? '1.0' : '0.8'}</priority>
  </url>`
    )
    .join('')}
  ${publishedArticles
    .map(
      (article) => `
  <url>
    <loc>${SITE.url}/article/${article.slug}</loc>
    <lastmod>${article.data.date.toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join('')}
</urlset>`;

  return new Response(sitemap.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
