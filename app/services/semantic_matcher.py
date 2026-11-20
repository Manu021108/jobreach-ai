"""
Semantic matching service using vector embeddings for job-candidate matching.
Supports pgvector (PostgreSQL) and in-memory fallback.
"""
import json
import logging
import os
from typing import Optional

import numpy as np
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

from app.config import settings
from app.db.models import JobEmbedding, JobPosting, ResumeEmbedding, User
from app.db.session import SessionLocal
from app.services.ai_writer import AIWriter

logger = logging.getLogger(__name__)

# Embedding model configuration
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # 384 dimensions
EMBEDDING_DIM = 384

# Try to import sentence-transformers, fall back gracefully
try:
    from sentence_transformers import SentenceTransformer
    _transformer_available = True
except ImportError:
    _transformer_available = False
    logger.warning("sentence-transformers not available. Install with: pip install sentence-transformers")

# Try to import pgvector, fall back to in-memory
try:
    from pgvector.sqlalchemy import Vector
    _pgvector_available = True
except ImportError:
    _pgvector_available = False
    logger.warning("pgvector not available. Install with: pip install pgvector")


class SemanticMatcher:
    """Semantic matching using vector embeddings."""

    def __init__(self):
        self._model = None
        self._model_name = EMBEDDING_MODEL

    def _get_model(self) -> Optional["SentenceTransformer"]:
        """Lazy load the embedding model."""
        if not _transformer_available:
            return None

        if self._model is None:
            try:
                self._model = SentenceTransformer(self._model_name)
                logger.info(f"Loaded embedding model: {self._model_name}")
            except Exception as e:
                logger.error(f"Failed to load embedding model: {e}")
                return None
        return self._model

    def generate_embedding(self, text: str) -> Optional[list[float]]:
        """Generate embedding for text."""
        model = self._get_model()
        if model is None:
            return None

        try:
            embedding = model.encode(text, normalize_embeddings=True)
            return embedding.tolist()
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return None

    def store_job_embedding(self, job_id: int, text: str) -> bool:
        """Generate and store embedding for a job posting."""
        embedding = self.generate_embedding(text)
        if embedding is None:
            return False

        try:
            with SessionLocal() as db:
                # Upsert embedding
                existing = db.get(JobEmbedding, job_id)
                if existing:
                    existing.embedding = embedding
                    existing.model_name = self._model_name
                    existing.updated_at = datetime.now(timezone.utc)
                else:
                    db.add(JobEmbedding(
                        job_id=job_id,
                        embedding=embedding,
                        model_name=self._model_name
                    ))
                db.commit()
            return True
        except Exception as e:
            logger.error(f"Failed to store job embedding: {e}")
            return False

    def store_resume_embedding(self, user_id: int, text: str) -> bool:
        """Generate and store embedding for a user's resume/profile."""
        embedding = self.generate_embedding(text)
        if embedding is None:
            return False

        try:
            with SessionLocal() as db:
                existing = db.get(ResumeEmbedding, user_id)
                if existing:
                    existing.embedding = embedding
                    existing.model_name = self._model_name
                    existing.source_text = text[:5000]  # Store truncated source
                    existing.updated_at = datetime.now(timezone.utc)
                else:
                    db.add(ResumeEmbedding(
                        user_id=user_id,
                        embedding=embedding,
                        model_name=self._model_name,
                        source_text=text[:5000]
                    ))
                db.commit()
            return True
        except Exception as e:
            logger.error(f"Failed to store resume embedding: {e}")
            return False

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two vectors."""
        a_np = np.array(a)
        b_np = np.array(b)
        return float(np.dot(a_np, b_np) / (np.linalg.norm(a_np) * np.linalg.norm(b_np)))

    def match_jobs_for_user(self, user_id: int, limit: int = 50, min_similarity: float = 0.3) -> list[dict]:
        """
        Find jobs matching user's resume using semantic similarity.
        Returns list of jobs with similarity scores.
        """
        # Get user's resume embedding
        with SessionLocal() as db:
            resume_embedding = db.get(ResumeEmbedding, user_id)
            if not resume_embedding or not resume_embedding.embedding:
                return []

            # Get all job embeddings
            job_embeddings = db.execute(
                select(JobEmbedding, JobPosting)
                .join(JobPosting, JobEmbedding.job_id == JobPosting.id)
                .where(JobPosting.active == True)
            ).all()

        if not job_embeddings:
            return []

        user_emb = np.array(resume_embedding.embedding)
        results = []

        for job_emb, job in job_embeddings:
            if not job_emb.embedding:
                continue

            similarity = self._cosine_similarity(resume_embedding.embedding, job_emb.embedding)

            if similarity >= min_similarity:
                results.append({
                    "job_id": job.id,
                    "job": {
                        "id": job.id,
                        "title": job.title,
                        "company_name": job.company_name,
                        "location": job.location,
                        "description": job.description,
                        "url": job.url,
                        "source": job.source,
                        "match_score": job.match_score,
                        "match_reasons": job.match_reasons,
                    },
                    "semantic_score": round(similarity * 100, 1),
                })

        # Sort by semantic similarity descending
        results.sort(key=lambda x: x["semantic_score"], reverse=True)
        return results[:limit]

    def find_similar_jobs(self, job_id: int, limit: int = 10) -> list[dict]:
        """Find jobs similar to a given job using embeddings."""
        with SessionLocal() as db:
            job_emb = db.get(JobEmbedding, job_id)
            if not job_emb or not job_emb.embedding:
                return []

            job_embeddings = db.execute(
                select(JobEmbedding, JobPosting)
                .join(JobPosting, JobEmbedding.job_id == JobPosting.id)
                .where(JobPosting.id != job_id, JobPosting.active == True)
            ).all()

        if not job_embeddings:
            return []

        target_emb = np.array(job_emb.embedding)
        results = []

        for other_emb, job in job_embeddings:
            if not other_emb.embedding:
                continue

            similarity = self._cosine_similarity(job_emb.embedding, other_emb.embedding)
            if similarity > 0.5:  # Only return reasonably similar jobs
                results.append({
                    "job_id": job.id,
                    "title": job.title,
                    "company_name": job.company_name,
                    "location": job.location,
                    "semantic_score": round(similarity * 100, 1),
                })

        results.sort(key=lambda x: x["semantic_score"], reverse=True)
        return results[:limit]

    def rebuild_all_embeddings(self, batch_size: int = 100) -> dict:
        """Rebuild all job embeddings from job descriptions."""
        with SessionLocal() as db:
            total_jobs = db.scalar(select(func.count(JobPosting.id)).where(JobPosting.active == True))
            jobs = db.scalars(
                select(JobPosting).where(JobPosting.active == True)
            ).all()

        processed = 0
        failed = 0

        for job in jobs:
            # Combine title, description, and company for rich context
            text = f"{job.title}. {job.description or ''}. Company: {job.company_name}. Location: {job.location or 'Remote'}."
            if self.store_job_embedding(job.id, text):
                processed += 1
            else:
                failed += 1

            if (processed + failed) % batch_size == 0:
                logger.info(f"Embedding progress: {processed + failed}/{total_jobs}")

        return {"total": total_jobs, "processed": processed, "failed": failed}


# Global instance
semantic_matcher = SemanticMatcher()


def get_semantic_matcher() -> SemanticMatcher:
    """Get the global semantic matcher instance."""
    return semantic_matcher