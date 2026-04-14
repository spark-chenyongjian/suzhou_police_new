import { describe, it, expect } from 'vitest';

describe('API End-to-End Tests', () => {
  const API_BASE = 'http://localhost:21000';

  it('should return health check successfully', async () => {
    const response = await fetch(`${API_BASE}/api/health`);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.version).toBeDefined();
  });

  it('should create and list sessions', async () => {
    // Create session
    const createResponse = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Session' })
    });
    // POST requests typically return 201 for created resources
    expect(createResponse.status).toBe(201);
    
    const session = await createResponse.json();
    expect(session.id).toBeDefined();
    expect(session.title).toBe('Test Session');

    // List sessions
    const listResponse = await fetch(`${API_BASE}/api/sessions`);
    expect(listResponse.status).toBe(200);
    
    const sessions = await listResponse.json();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('should handle chat messages', async () => {
    // Create session first
    const createResponse = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat Test' })
    });
    const session = await createResponse.json();

    // Send message
    const messageResponse = await fetch(`${API_BASE}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sessionId: session.id, 
        content: 'Hello, test!' 
      })
    });
    expect(messageResponse.status).toBe(200);
    
    const messageResult = await messageResponse.json();
    expect(messageResult.messageId).toBeDefined();
  });
});