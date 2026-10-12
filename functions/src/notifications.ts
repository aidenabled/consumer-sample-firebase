export interface NotificationConfig {
  baseUrl: string;
  username: string;
  password: string;
  serviceUrl: string;
  title: string;
  message: string;
}

// Based on the existing AiDEN consumer API contract. No vehicle/customer secrets in logs.
export class AidenNotifications {
  private token?: {value: string; expiresAt: number};
  constructor(private config: NotificationConfig, private http: typeof fetch = fetch) {}

  private async post(path: string, body: unknown, token?: string): Promise<Response> {
    return this.http(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: {"Content-Type": "application/json", ...(token ? {Authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify(body),
    });
  }

  private async authenticate(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const response = await this.post("/shared/api/v1/auth/login", {
      username: this.config.username, password: this.config.password,
    });
    if (!response.ok) throw new Error(`AiDEN authentication failed (${response.status}).`);
    const data = await response.json() as {accessToken?: string; expiresIn?: number};
    if (!data.accessToken || typeof data.expiresIn !== "number" || data.expiresIn <= 0) {
      throw new Error("AiDEN authentication returned an invalid token.");
    }
    this.token = {value: data.accessToken, expiresAt: Date.now() + Math.max(0, data.expiresIn - 30) * 1000};
    return this.token.value;
  }

  async send(vin: string, messageId: string): Promise<void> {
    for (const [name, value] of Object.entries(this.config)) {
      if (!value) throw new Error(`Missing notification configuration: ${name}.`);
    }
    for (const value of [this.config.baseUrl, this.config.serviceUrl]) {
      if (new URL(value).protocol !== "https:") throw new Error("Notification URLs must use HTTPS.");
    }
    const url = new URL("/authorize", this.config.serviceUrl).href;
    const payload = {
      title: this.config.title, message: this.config.message, vin_numbers: [vin],
      url_authentication_enabled: true, url,
    };
    let response = await this.post("/consumer/api/v1/send-notification", payload, await this.authenticate());
    // Retry only an explicit auth rejection. Network/5xx errors are handled by trigger retries.
    if (response.status === 401) {
      await response.body?.cancel();
      this.token = undefined;
      response = await this.post("/consumer/api/v1/send-notification", payload, await this.authenticate());
    }
    await response.body?.cancel();
    if (!response.ok) throw new Error(`AiDEN notification failed (${response.status}) for event ${messageId}.`);
  }
}
