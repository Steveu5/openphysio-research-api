-- Research workspace performance and uniqueness safeguards.
-- Safe to run repeatedly.

create unique index if not exists research_saved_articles_user_article_uidx
  on public.research_saved_articles (user_id, article_id);

create index if not exists research_saved_articles_user_saved_at_idx
  on public.research_saved_articles (user_id, saved_at desc);

create index if not exists research_saved_articles_user_collection_idx
  on public.research_saved_articles (user_id, collection_name);

create index if not exists research_search_queries_user_created_at_idx
  on public.research_search_queries (user_id, created_at desc);

create index if not exists research_search_results_query_id_idx
  on public.research_search_results (query_id);
