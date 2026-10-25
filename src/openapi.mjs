export function openapi(base) {
  const response = { description: 'Current task state', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } };
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
  return {
    openapi: '3.1.0', info: { title: 'Pocket Codex', version: '1.0.0', description: 'Send work to your Windows PC and read progress. Human approvals happen in the dashboard.' },
    servers: [{ url: base || 'https://YOUR-TUNNEL.example.com' }], security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: {} },
    paths: {
      '/api/status': { get: { operationId: 'computerStatus', summary: 'Check bridge status', responses: { 200: response } } },
      '/api/tasks': {
        get: { operationId: 'listTasks', summary: 'List the 30 latest tasks', responses: { 200: response } },
        post: { operationId: 'createTask', summary: 'Ask Codex to do a task on the PC', 'x-openai-isConsequential': true,
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['prompt', 'requestId'], properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 16000, description: 'Exact user-authorized computer task' },
            requestId: { type: 'string', minLength: 8, maxLength: 100, description: 'Unique request identifier. Reuse it when retrying this exact request.' },
            parentId: { type: 'string', format: 'uuid', description: 'Completed task ID to continue its conversation' }
          } } } } }, responses: { 202: response } }
      },
      '/api/tasks/{id}': { get: { operationId: 'getTask', summary: 'Get progress, result and dashboard link', parameters: [id], responses: { 200: response } } },
      '/api/tasks/{id}/cancel': { post: { operationId: 'cancelTask', summary: 'Interrupt a task; completed effects cannot be undone', 'x-openai-isConsequential': true, parameters: [id], responses: { 200: response } } }
    }
  };
}
