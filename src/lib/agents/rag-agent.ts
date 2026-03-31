/**
 * RAG Agent — Retrieves wisdom from embedded books and questions
 *
 * Directly calls semantic search functions (retrieveWisdom + retrieveQuestion)
 * in parallel. No LangChain ReactAgent overhead — faster, reliable, no bundler issues.
 */

import { retrieveWisdom, retrieveQuestion } from '../rag/retriever';
import type { MCPContext } from './mcp-context';
import { trackAgent, recordError } from './mcp-context';

/** Run the RAG agent and write results to MCP context */
export async function runRAGAgent(ctx: MCPContext): Promise<void> {
  const done = trackAgent(ctx, 'rag-agent');
  try {
    // Build conversation context for contextual re-ranking
    const conversationContext = ctx.conversationHistory
      .slice(-6)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    // Run book search (with re-ranking) and question search in parallel
    const [wisdom, questions] = await Promise.all([
      retrieveWisdom(ctx.userMessage, 8, conversationContext || undefined),
      retrieveQuestion(ctx.userMessage, undefined, undefined, 3),
    ]);

    ctx.ragContext = wisdom;
    ctx.questionSuggestions = questions;

    // Log RAG results for debugging
    const passageCount = wisdom.split('---').filter(s => s.trim().length > 0).length;
    const hasWisdom = !wisdom.includes('No wisdom') && !wisdom.includes('unavailable');
    console.log(`[RAG] ${hasWisdom ? '✅' : '⚠️'} Retrieved ${passageCount} passages, ${questions.length} questions for: "${ctx.userMessage.substring(0, 60)}..."`);

    // RAG audit logging — confirm book passages are reaching the agent
    const wisdomSnippet = wisdom && wisdom !== 'No wisdom passages found in the library yet.'
      ? wisdom.substring(0, 200) + (wisdom.length > 200 ? '…' : '')
      : '(none)';
    console.log(`[RAG] Retrieved ${questions.length} questions | Wisdom snippet: ${wisdomSnippet}`);

  } catch (error) {
    recordError(ctx, 'rag-agent', error);
    ctx.ragContext = 'Wisdom retrieval temporarily unavailable.';
  } finally {
    done();
  }
}

