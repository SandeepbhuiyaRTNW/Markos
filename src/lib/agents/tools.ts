/**
 * LangChain Tool Definitions for the Marcus Multi-Agent System
 * Wraps existing retrieval, memory, KWML, and understanding functions as LangChain tools
 */

import { tool } from 'langchain';
import { z } from 'zod';
import { retrieveWisdom, retrieveQuestion } from '../rag/retriever';
import { getMemoryContext, storeMemory } from '../memory/memory-manager';
import { detectKWML, getKWMLContext } from '../kwml/detector';
import { analyzeUnderstanding } from '../understanding/stack';

// --- RAG Tools ---

export const searchBooksTool = tool(
  async ({ query, limit }: { query: string; limit: number }) => {
    const results = await retrieveWisdom(query, limit);
    return results;
  },
  {
    name: 'search_books',
    description:
      'Search the embedded book library (Stoic philosophy, KWML archetypes, masculinity, psychology) using semantic similarity. Use this to find relevant wisdom passages for the user\'s situation.',
    schema: z.object({
      query: z.string().describe('The search query based on the user\'s message or topic'),
      limit: z.number().default(5).describe('Number of results to return (default 5)'),
    }),
  }
);

export const searchQuestionsTool = tool(
  async ({ context, archetype, functionType, limit }: { context: string; archetype?: string; functionType?: string; limit: number }) => {
    const questions = await retrieveQuestion(context, archetype, functionType, limit);
    return questions.length > 0
      ? questions.join('\n')
      : 'No matching questions found.';
  },
  {
    name: 'search_questions',
    description:
      'Search the question database for powerful Socratic questions relevant to the conversation. Can filter by KWML archetype (king/warrior/magician/lover).',
    schema: z.object({
      context: z.string().describe('The conversation context to match questions against'),
      archetype: z.string().optional().describe('KWML archetype filter: king, warrior, magician, or lover'),
      functionType: z.string().optional().describe('Question function type filter'),
      limit: z.number().default(3).describe('Number of questions to return'),
    }),
  }
);

// --- Memory Tools ---

export const getMemoryTool = tool(
  async ({ userId }: { userId: string }) => {
    const context = await getMemoryContext(userId);
    return context;
  },
  {
    name: 'get_user_memory',
    description:
      'Retrieve all stored memory layers for a user. Returns identity, relationships, goals, challenges, decision patterns, wins, and KWML profile.',
    schema: z.object({
      userId: z.string().describe('The user ID to retrieve memories for'),
    }),
  }
);

export const storeMemoryTool = tool(
  async ({ userId, layerNumber, key, value, confidence }: { userId: string; layerNumber: number; key: string; value: string; confidence: number }) => {
    await storeMemory(userId, layerNumber, key, value, confidence);
    return `Memory stored: Layer ${layerNumber} - ${key}: ${value}`;
  },
  {
    name: 'store_memory',
    description:
      'Store a memory fact about the user. Layers: 1=Identity, 2=Relationships, 3=Goals, 4=Challenges, 5=Decision Patterns, 6=Wins, 7=KWML Profile.',
    schema: z.object({
      userId: z.string().describe('The user ID'),
      layerNumber: z.number().min(1).max(7).describe('Memory layer (1-7)'),
      key: z.string().describe('Short label for the memory'),
      value: z.string().describe('The memory content'),
      confidence: z.number().min(0).max(1).default(0.5).describe('Confidence score 0-1'),
    }),
  }
);

// --- KWML Tools ---

export const detectArchetypeTool = tool(
  async ({ userMessage, conversationHistory }: { userMessage: string; conversationHistory: string }) => {
    const reading = await detectKWML(userMessage, conversationHistory);
    let result = `Dominant: ${reading.dominant} | K:${reading.king.toFixed(2)} W:${reading.warrior.toFixed(2)} M:${reading.magician.toFixed(2)} L:${reading.lover.toFixed(2)}`;
    if (reading.shadowActive) {
      const shadows = [reading.kingShadow, reading.warriorShadow, reading.magicianShadow, reading.loverShadow].filter(Boolean);
      result += ` | Shadows: ${shadows.join(', ')}`;
    }
    return result;
  },
  {
    name: 'detect_archetype',
    description:
      'Detect the KWML archetypal pattern in the user\'s message. Returns King/Warrior/Magician/Lover scores and active shadow patterns.',
    schema: z.object({
      userMessage: z.string().describe('The user\'s message to analyze'),
      conversationHistory: z.string().describe('Recent conversation history for context'),
    }),
  }
);

export const getKWMLProfileTool = tool(
  async ({ userId }: { userId: string }) => {
    return await getKWMLContext(userId);
  },
  {
    name: 'get_kwml_profile',
    description: 'Get the stored KWML archetypal profile for a user.',
    schema: z.object({
      userId: z.string().describe('The user ID'),
    }),
  }
);

// --- Understanding Tools ---

export const analyzeUnderstandingTool = tool(
  async ({ userMessage, conversationHistory, memoryContext }: { userMessage: string; conversationHistory: string; memoryContext: string }) => {
    const analysis = await analyzeUnderstanding(userMessage, conversationHistory, memoryContext);
    return JSON.stringify(analysis, null, 2);
  },
  {
    name: 'analyze_understanding',
    description:
      'Analyze the user\'s message across all 5 layers: Words, Emotion, Pattern, The Man, The Silence. Returns deep understanding of what the user is really saying.',
    schema: z.object({
      userMessage: z.string().describe('The user\'s message'),
      conversationHistory: z.string().describe('Conversation history'),
      memoryContext: z.string().describe('Known memory context about the user'),
    }),
  }
);

// Export all tools as arrays for different agent configurations
export const ragTools = [searchBooksTool, searchQuestionsTool];
export const memoryTools = [getMemoryTool, storeMemoryTool];
export const kwmlTools = [detectArchetypeTool, getKWMLProfileTool];
export const understandingTools = [analyzeUnderstandingTool];
export const allTools = [...ragTools, ...memoryTools, ...kwmlTools, ...understandingTools];

