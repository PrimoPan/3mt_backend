import express, { Request, Response } from "express";
import dotenv from "dotenv";
import axios, { AxiosError } from "axios";
import axiosRetry from "axios-retry";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

const { API_URL, API_KEY, MODEL } = process.env;
if (!API_URL || !API_KEY) {
  console.error("Missing API_URL or API_KEY in .env");
  process.exit(1);
}
const MODEL_NAME = MODEL || "gpt-3.5-turbo";

const http = axios.create({ timeout: 30_000 });
axiosRetry(http, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    if ((error as any).code === "ECONNABORTED") return true;
    const status = (error as AxiosError).response?.status;
    return status ? [429, 500, 502, 503, 504].includes(status) : false;
  }
});

interface Step {
  position: number;
  name: string;
  description: string;
}

app.post("/api/convert", async (req: Request, res: Response) => {
  try {
    const { text, steps }: { text?: string; steps?: Step[] } = req.body || {};

    if (text === "steps_reordered" && Array.isArray(steps)) {
      const stepsText = steps.map(s => `${s.position}. ${s.name}: ${s.description}`).join("\n");

      const upstream = await http.post(API_URL, {
        model: MODEL_NAME,
        messages: [
          { role: "system", content: "You are helping to analyze the structure of a 3MT presentation." },
          { role: "user", content: `The steps have been reordered to:\n\n${stepsText}\n\nPlease provide feedback on this structure.` }
        ]
      }, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": API_KEY // 按原 Python：非 Bearer
        }
      });

      return res.json(upstream.data);
    }

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    console.log("Received text:", text);

    const upstream = await http.post(API_URL, {
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content: `You are acting as a general audience member who is not familiar with the topic. 
1) Ask clarifying questions if something is unclear
2) Point out parts that are hard to understand
3) Suggest where more explanation might be needed
4) Help make the explanation more accessible to a general audience

Keep your responses conversational and focused on understanding the topic better.`
        },
        {
          role: "user",
          content: `Here's the topic I'm explaining:\n\n${text}\n\nAs someone unfamiliar with this topic, what questions or suggestions do you have?`
        }
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": API_KEY
      }
    });

    return res.json(upstream.data);
  } catch (e) {
    const err = e as AxiosError;
    const status = err.response?.status;
    const data = err.response?.data;
    console.error("Upstream error:", status, data);

    // 用 502 比 500 更贴切：上游网关/服务失败
    return res.status(502).json({
      error: "API request failed",
      status,
      details: data ?? String(err)
    });
  }
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy" });
});

app.get("/api/helloworld", (req: Request, res: Response) => {
  const raw = req.query.message;
  const message = Array.isArray(raw) ? raw[0] : raw;
  if (message === "hello") return res.json({ message: "Hello World from 3mt server" });
  return res.json({ message: "please say hello" });
});

const PORT = Number(process.env.PORT) || 2999;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
