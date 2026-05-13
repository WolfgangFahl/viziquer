import { fetch, Headers } from 'meteor/fetch';
import crypto from 'crypto';

import { validate_api_key } from './methods/api_keys.js';
import {
  Projects,
  Diagrams,
  Elements,
  Compartments,
  Services,
  Tools,
  ToolVersions,
  Users,
  ApiKeys,
} from '../../db/platform/collections.js';
import { generate_id } from '../../libs/platform/lib.js';

function api_key_auth() {
  return async function (req, res, next) {
    const auth_header = req.headers['authorization'];
    if (!auth_header || !auth_header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer vq_<api-key>' });
    }

    const api_key = auth_header.slice(7);
    const context = await validate_api_key(api_key);

    if (!context) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.apiContext = context;
    next();
  };
}

async function resolve_project_id(projectId, projectName) {
  if (projectId) return projectId;
  if (projectName) {
    const project = await Projects.findOneAsync({ name: projectName });
    if (project) return project._id;
  }
  return null;
}

async function execute_sparql_query_internal(query, endpoint, options = {}) {
  const headers = new Headers();
  headers.set('Accept', 'application/sparql-results+json, application/json');

  if (options.username && options.password) {
    const basic = Buffer.from(`${options.username}:${options.password}`).toString('base64');
    headers.set('Authorization', `Basic ${basic}`);
  }

  const req_options = {
    method: 'POST',
    headers,
    body: `query=${encodeURIComponent(query)}`,
    redirect: 'follow',
    timeout: 75000,
  };

  if (options.httpRequestProfileName === 'url_parameters') {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }

  try {
    const resp = await fetch(endpoint, req_options);
    if (!resp.ok) {
      const text = await resp.text();
      return { status: 500, error: `Endpoint returned ${resp.status}: ${text.slice(0, 500)}` };
    }

    const content_type = resp.headers.get('content-type') || '';
    let result;

    if (content_type.includes('json')) {
      result = await resp.json();
    } else if (content_type.includes('xml') || content_type.includes('sparql')) {
      const text = await resp.text();
      result = { raw: text, contentType: 'xml' };
    } else {
      const text = await resp.text();
      result = { raw: text, contentType: content_type };
    }

    return { status: 200, result };
  } catch (err) {
    console.error('SPARQL execution failed:', err);
    return { status: 504, error: 'Execution failed: ' + err.message };
  }
}

function setup_api_routes(app) {
  const auth = api_key_auth();

  app.get('/v1/health', async function (req, res) {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/v1/mcp-install', async function (req, res) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return res.status(403).json({ error: 'localhost only' });
    }
    try {
      let project = await Projects.findOneAsync({});
      if (!project) {
        const anyUser = await Users.findOneAsync({});
        const userId = anyUser ? anyUser._id : null;
        const tool = await Tools.findOneAsync({});
        const projectId = generate_id();
        await Projects.insertAsync({
          _id: projectId,
          name: 'Default',
          toolId: tool ? tool._id : null,
          createdAt: new Date(),
          createdBy: userId,
          archive: false,
        });
        project = { _id: projectId };
      }

      const API_KEY_PREFIX = 'vq_';
      const raw_key = API_KEY_PREFIX + crypto.randomBytes(48).toString('base64url');
      const hashed_key = crypto.createHash('sha256').update(raw_key).digest('hex');

      await ApiKeys.insertAsync({
        projectId: project._id,
        apiKey: hashed_key,
        label: 'MCP auto-generated',
        createdAt: new Date(),
        lastUsedAt: null,
      });

      return res.status(200).json({ apiKey: raw_key });
    } catch (err) {
      console.error('mcp-install error:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/v1/projects/:projectId/diagrams', auth, async function (req, res) {
    try {
      const { projectId } = req.params;

      if (req.apiContext.projectId !== projectId) {
        return res.status(403).json({ error: 'API key is not authorized for this project' });
      }

      const project = await Projects.findOneAsync({ _id: projectId });
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const diagrams = await Diagrams.find(
        { projectId },
        { fields: { _id: 1, name: 1, diagramTypeId: 1, versionId: 1, createdAt: 1, createdBy: 1 } },
      ).fetchAsync();

      return res.status(200).json(diagrams);
    } catch (err) {
      console.error('Error fetching diagrams:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/v1/projects/:projectId/diagrams/:diagramId', auth, async function (req, res) {
    try {
      const { projectId, diagramId } = req.params;

      if (req.apiContext.projectId !== projectId) {
        return res.status(403).json({ error: 'API key is not authorized for this project' });
      }

      const diagram = await Diagrams.findOneAsync({ _id: diagramId, projectId });
      if (!diagram) {
        return res.status(404).json({ error: 'Diagram not found' });
      }

      const elements = await Elements.find(
        { diagramId, projectId },
        { fields: { _id: 1, name: 1, type: 1, x: 1, y: 1, width: 1, height: 1 } },
      ).fetchAsync();

      const compartments = await Compartments.find(
        { diagramId, projectId },
      ).fetchAsync();

      return res.status(200).json({ diagram, elements, compartments });
    } catch (err) {
      console.error('Error fetching diagram:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/v1/sparql/execute', auth, async function (req, res) {
    try {
      const { query, endpoint, projectId, serviceId } = req.body;

      if (!query) {
        return res.status(400).json({ error: 'Query is required' });
      }

      let target_endpoint = endpoint;
      let auth_options = {};

      if (serviceId && projectId) {
        const service = await Services.findOneAsync({ _id: serviceId });
        if (service) {
          target_endpoint = service.endpoint;
          auth_options = {
            username: service.endpointUsername,
            password: service.endpointPassword,
            httpRequestProfileName: service.httpRequestProfileName,
          };
        }
      }

      if (!target_endpoint) {
        return res.status(400).json({ error: 'No SPARQL endpoint specified' });
      }

      const result = await execute_sparql_query_internal(query, target_endpoint, auth_options);
      return res.status(result.status).json(result);
    } catch (err) {
      console.error('Error executing SPARQL:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/v1/services', auth, async function (req, res) {
    try {
      const services = await Services.find({}).fetchAsync();
      const sanitized = services.map(function (s) {
        const { endpointPassword, endpointUsername, ...rest } = s;
        return rest;
      });
      return res.status(200).json(sanitized);
    } catch (err) {
      console.error('Error fetching services:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/mcp', auth, async function (req, res) {
    try {
      const { jsonrpc, id, method, params } = req.body;

      if (jsonrpc !== '2.0') {
        return res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
      }

      switch (method) {
        case 'initialize':
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'ViziQuer MCP Server', version: '1.0.0' },
              capabilities: { tools: {} },
            },
          });

        case 'tools/list':
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            result: {
              tools: [
                {
                  name: 'sparql_execute',
                  description: 'Execute a SPARQL query against a specified endpoint',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string', description: 'The SPARQL query to execute' },
                      endpoint: { type: 'string', description: 'The SPARQL endpoint URL' },
                      serviceId: { type: 'string', description: 'Optional service ID from configured services' },
                    },
                    required: ['query'],
                  },
                },
                {
                  name: 'list_diagrams',
                  description: 'List all diagrams in the project',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      projectId: { type: 'string', description: 'The project ID (or use projectName instead)' },
                      projectName: { type: 'string', description: 'The project name (resolved to ID internally)' },
                    },
                    anyOf: [
                      { required: ['projectId'] },
                      { required: ['projectName'] },
                    ],
                  },
                },
                {
                  name: 'get_diagram',
                  description: 'Get diagram details including elements and compartments',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      projectId: { type: 'string', description: 'The project ID (or use projectName instead)' },
                      projectName: { type: 'string', description: 'The project name (resolved to ID internally)' },
                      diagramId: { type: 'string', description: 'The diagram ID' },
                    },
                    anyOf: [
                      { required: ['projectId', 'diagramId'] },
                      { required: ['projectName', 'diagramId'] },
                    ],
                  },
                },
              ],
            },
          });

        case 'tools/call': {
          const { name, arguments: args } = params;

          if (name === 'sparql_execute') {
            const { query, endpoint, serviceId } = args || {};
            if (!query) {
              return res.status(200).json({
                jsonrpc: '2.0', id,
                result: { content: [{ type: 'text', text: JSON.stringify({ error: 'Query is required' }) }] },
              });
            }

            let target_endpoint = endpoint;
            let auth_options = {};

            if (serviceId && req.apiContext.projectId) {
              const service = await Services.findOneAsync({ _id: serviceId });
              if (service) {
                target_endpoint = service.endpoint;
                auth_options = {
                  username: service.endpointUsername,
                  password: service.endpointPassword,
                  httpRequestProfileName: service.httpRequestProfileName,
                };
              }
            }

            if (!target_endpoint) {
              return res.status(200).json({
                jsonrpc: '2.0', id,
                result: { content: [{ type: 'text', text: JSON.stringify({ error: 'No endpoint specified' }) }] },
              });
            }

            const result = await execute_sparql_query_internal(query, target_endpoint, auth_options);
            return res.status(200).json({
              jsonrpc: '2.0', id,
              result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
            });
          }

          if (name === 'list_diagrams') {
            const { projectId, projectName } = args || {};
            const resolvedId = await resolve_project_id(projectId, projectName);
            if (!resolvedId) {
              return res.status(200).json({
                jsonrpc: '2.0', id,
                result: { content: [{ type: 'text', text: JSON.stringify({ error: 'projectId or projectName is required' }) }] },
              });
            }
            const diagrams = await Diagrams.find(
              { projectId: resolvedId },
              { fields: { _id: 1, name: 1, diagramTypeId: 1, versionId: 1, createdAt: 1 } },
            ).fetchAsync();
            return res.status(200).json({
              jsonrpc: '2.0', id,
              result: { content: [{ type: 'text', text: JSON.stringify(diagrams, null, 2) }] },
            });
          }

          if (name === 'get_diagram') {
            const { projectId, projectName, diagramId } = args || {};
            const resolvedId = await resolve_project_id(projectId, projectName);
            if (!resolvedId) {
              return res.status(200).json({
                jsonrpc: '2.0', id,
                result: { content: [{ type: 'text', text: JSON.stringify({ error: 'projectId or projectName is required' }) }] },
              });
            }
            const diagram = await Diagrams.findOneAsync({ _id: diagramId, projectId: resolvedId });
            const elements = await Elements.find({ diagramId, projectId: resolvedId }).fetchAsync();
            const compartments = await Compartments.find({ diagramId, projectId: resolvedId }).fetchAsync();
            return res.status(200).json({
              jsonrpc: '2.0', id,
              result: { content: [{ type: 'text', text: JSON.stringify({ diagram, elements, compartments }, null, 2) }] },
            });
          }

          return res.status(200).json({
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] },
          });
        }

        default:
          return res.status(200).json({
            jsonrpc: '2.0', id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
      }
    } catch (err) {
      console.error('MCP error:', err);
      return res.status(200).json({
        jsonrpc: '2.0',
        id: req.body.id || null,
        error: { code: -32603, message: err.message },
      });
    }
  });
}

export { api_key_auth, resolve_project_id, execute_sparql_query_internal, setup_api_routes };
