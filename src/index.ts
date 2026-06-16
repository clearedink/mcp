
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

const PACKAGE_NAME = "@clearedink/mcp";
const PACKAGE_VERSION = "0.1.1";

const API_BASE = (process.env.CLEARED_API_BASE || "https://api.cleared.ink").replace(
  /\/+$/,
  "",
);

const DEFAULT_OUTPUT_DIR = "cleared-output";

const server = new Server(
  {
    name: "cleared",
    version: PACKAGE_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const EmptySchema = z.object({}).optional();

const JobAuthSchema = z.object({
  job_id: z.string().min(1, "job_id is required"),
  job_token: z.string().min(1, "job_token is required"),
});

const DownloadResultSchema = JobAuthSchema.extend({
  output_dir: z
    .string()
    .min(1)
    .optional()
    .describe(`Optional output directory. Defaults to ./${DEFAULT_OUTPUT_DIR}`),
});

type JsonObject = Record<string, unknown>;

function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function jsonResponse(data: JsonObject) {
  return textResponse(JSON.stringify(data, null, 2));
}

function errorResponse(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    isError: true,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function encodeJobPath(jobId: string): string {
  return encodeURIComponent(jobId);
}

function withToken(url: string, token: string): string {
  const u = new URL(url);
  u.searchParams.set("token", token);
  return u.toString();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": `${PACKAGE_NAME}/${PACKAGE_VERSION}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`);
  }

  return res.json();
}

async function fetchVideoBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": `${PACKAGE_NAME}/${PACKAGE_VERSION}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getStatusUrl(jobId: string, jobToken: string): string {
  return withToken(`${API_BASE}/wan/jobs/${encodeJobPath(jobId)}`, jobToken);
}

function getResultUrl(jobId: string, jobToken: string): string {
  return withToken(`${API_BASE}/wan/jobs/${encodeJobPath(jobId)}/result`, jobToken);
}

function getSafeOutputPath(outputDir: string, jobId: string): string {
  const safeJobId = jobId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(outputDir, `${safeJobId}.mp4`);
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_cleared_pricing",
        description:
          "Get public Cleared Wan video pricing and endpoint information. This tool is free and does not make x402 payments.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
      {
        name: "get_cleared_job_status",
        description:
          "Check the status of an async Cleared Wan video job. This tool is free and does not make x402 payments.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: {
              type: "string",
              description: "The Cleared job id returned by the paid x402 request.",
            },
            job_token: {
              type: "string",
              description: "The private job token returned by the paid x402 request.",
            },
          },
          required: ["job_id", "job_token"],
          additionalProperties: false,
        },
      },
      {
        name: "get_cleared_job_result",
        description:
          "Retrieve the result metadata for a completed Cleared Wan video job, including the MP4 URL when available. This tool is free and does not make x402 payments.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: {
              type: "string",
              description: "The Cleared job id returned by the paid x402 request.",
            },
            job_token: {
              type: "string",
              description: "The private job token returned by the paid x402 request.",
            },
          },
          required: ["job_id", "job_token"],
          additionalProperties: false,
        },
      },
      {
        name: "download_cleared_result",
        description:
          "Download the completed MP4 result for a Cleared Wan video job to a local directory. This tool is free and does not make x402 payments.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: {
              type: "string",
              description: "The Cleared job id returned by the paid x402 request.",
            },
            job_token: {
              type: "string",
              description: "The private job token returned by the paid x402 request.",
            },
            output_dir: {
              type: "string",
              description: `Optional output directory path. Defaults to ./${DEFAULT_OUTPUT_DIR}.`,
            },
          },
          required: ["job_id", "job_token"],
          additionalProperties: false,
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  try {
    if (toolName === "get_cleared_pricing") {
      EmptySchema.parse(request.params.arguments);

      return jsonResponse({
        service: "Cleared Wan video generation",
        api_base: API_BASE,
        payment_protocol: "x402",
        note:
          "Paid job creation is handled by Cleared's x402 endpoints. This MCP server provides free companion tools for pricing, status, result retrieval, and downloads.",
        endpoints: {
          create_480p_job: {
            method: "POST",
            url: `${API_BASE}/wan/generate/480p`,
            price_atomic_usdc: 10000,
            price_usdc: "0.01",
            description: "Wan image-to-video 480p async job",
          },
          create_720p_job: {
            method: "POST",
            url: `${API_BASE}/wan/generate/720p`,
            price_atomic_usdc: 50000,
            price_usdc: "0.05",
            description: "Wan image-to-video 720p async job",
          },
          status: {
            method: "GET",
            url_template: `${API_BASE}/wan/jobs/{job_id}?token={job_token}`,
          },
          result: {
            method: "GET",
            url_template: `${API_BASE}/wan/jobs/{job_id}/result?token={job_token}`,
          },
        },
      });
    }

    if (toolName === "get_cleared_job_status") {
      const args = JobAuthSchema.parse(request.params.arguments);
      const data = await fetchJson(getStatusUrl(args.job_id, args.job_token));

      return jsonResponse({
        job_id: args.job_id,
        ...((data && typeof data === "object" ? data : { response: data }) as JsonObject),
      });
    }

    if (toolName === "get_cleared_job_result") {
      const args = JobAuthSchema.parse(request.params.arguments);
      const data = await fetchJson(getResultUrl(args.job_id, args.job_token));

      return jsonResponse({
        job_id: args.job_id,
        mime_type: "video/mp4",
        ...((data && typeof data === "object" ? data : { response: data }) as JsonObject),
      });
    }

    if (toolName === "download_cleared_result") {
      const args = DownloadResultSchema.parse(request.params.arguments);

      const outputDir = path.resolve(args.output_dir || DEFAULT_OUTPUT_DIR);
      await fs.mkdir(outputDir, { recursive: true });

      const resultData = await fetchJson(getResultUrl(args.job_id, args.job_token));

      let videoUrl: unknown;

      if (resultData && typeof resultData === "object") {
        const result = resultData as Record<string, unknown>;
        videoUrl =
          result.video_url ||
          result.url ||
          result.output_url ||
          result.download_url;
      }

      if (typeof videoUrl !== "string" || !videoUrl.startsWith("http")) {
        return errorResponse(
          "No downloadable video URL found. The job may not be completed yet, or the result response did not include video_url.",
        );
      }

      const localPath = getSafeOutputPath(outputDir, args.job_id);
      const buffer = await fetchVideoBuffer(videoUrl);
      await fs.writeFile(localPath, buffer);

      return jsonResponse({
        job_id: args.job_id,
        status: "downloaded",
        local_path: localPath,
        bytes: buffer.byteLength,
        mime_type: "video/mp4",
      });
    }

    return errorResponse(`Unknown tool: ${toolName}`);
  } catch (error) {
    return errorResponse(`Cleared MCP error: ${getErrorMessage(error)}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Cleared MCP Server ${PACKAGE_VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal Cleared MCP error:", error);
  process.exit(1);
});

