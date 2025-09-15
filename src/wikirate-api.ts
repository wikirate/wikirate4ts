/*
  TypeScript client for the Wikirate API (parity-focused port of the provided Python client)
  - Node 18+ (has global fetch & FormData)
  - Uses fetch; no external deps required. For file uploads, Node's fs.createReadStream is used.

  Notes:
  • This is designed to be drop-in usable. Error classes mirror the Python ones.
  • Model interfaces are left generic (Record<string, any>) so you can replace them with your own strong types.
*/

import { createReadStream, existsSync } from "node:fs";
import { URL, URLSearchParams } from "node:url";

/***********************************
 * Exceptions (mirroring Python)
 ***********************************/
export class Wikirate4PyException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Wikirate4PyException";
  }
}

export class HTTPException extends Wikirate4PyException {
  response: Response;
  status: number;
  bodyText?: string;
  constructor(response: Response, bodyText?: string) {
    super(`HTTP ${response.status}: ${response.statusText}`);
    this.name = "HTTPException";
    this.response = response;
    this.status = response.status;
    this.bodyText = bodyText;
  }
}

export class IllegalHttpMethod extends Wikirate4PyException {}
export class BadRequestException extends HTTPException {}
export class UnauthorizedException extends HTTPException {}
export class ForbiddenException extends HTTPException {}
export class NotFoundException extends HTTPException {}
export class TooManyRequestsException extends HTTPException {}
export class WikirateServerErrorException extends HTTPException {}

/***********************************
 * Generic model placeholders
 ***********************************/
export type Company = Record<string, any>;
export type Topic = Record<string, any>;
export type Metric = Record<string, any>;
export type ResearchGroup = Record<string, any>;
export type CompanyGroup = Record<string, any>;
export type Source = Record<string, any>;
export type CompanyItem = Record<string, any>;
export type MetricItem = Record<string, any>;
export type Answer = Record<string, any>;
export type ResearchGroupItem = Record<string, any>;
export type Relationship = Record<string, any>;
export type SourceItem = Record<string, any>;
export type TopicItem = Record<string, any>;
export type AnswerItem = Record<string, any>;
export type CompanyGroupItem = Record<string, any>;
export type RelationshipItem = Record<string, any>;
export type Region = Record<string, any>;
export type Project = Record<string, any>;
export type ProjectItem = Record<string, any>;
export type RegionItem = Record<string, any>;
export type Dataset = Record<string, any>;
export type DatasetItem = Record<string, any>;

/***********************************
 * Config
 ***********************************/
export const WIKIRATE_API_URL = process.env.WIKIRATE_API_URL ?? "https://wikirate.org/";
const WIKIRATE_API_PATH = new URL(WIKIRATE_API_URL).pathname;

/***********************************
 * Helpers
 ***********************************/
export function generateUrlKey(input: string | number): string {
  const s = String(input);
  // Replace any char not in [a-zA-Z0-9_+~] with space, except keep '+' as-is
  const replaced = s.replace(/[^a-zA-Z0-9_+~]+/g, (m) => (m !== "+" ? " " : "+"));
  // Collapse whitespace to underscore
  return replaced.replace(/\s+/g, "_");
}

export function buildCardIdentifier(card: string | number): string {
  const str = String(card);
  const isDigit = /^\d+$/.test(str);
  return isDigit ? `~${str}` : generateUrlKey(str);
}

function constructEndpoint(entityId: string | number | null | undefined, entityType: string): string {
  if (entityId !== undefined && entityId !== null) {
    const prefix = /^\d+$/.test(String(entityId)) ? `~${entityId}` : generateUrlKey(String(entityId));
    return `${prefix}+${entityType}.json`;
  }
  return `${entityType}.json`;
}

/** Join relative paths to base API URL */
function formatPath(path: string, base: string = WIKIRATE_API_URL): string {
  if (path.startsWith(base)) return path; // already absolute
  if (path.startsWith("/")) return new URL(path.replace(/^\/+/, ""), base).toString();
  return new URL(path, base).toString();
}

function listToStr(list: Array<string | number>): string {
  return list.map(String).join("\n");
}

/***********************************
 * Core API
 ***********************************/
export type BasicAuth = { username: string; password: string } | undefined;

export interface RequestOptions {
  method: "get" | "post" | "delete";
  path: string;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  files?: Record<string, string | Blob | File | NodeJS.ReadableStream>;
}

export class API {
  private oauthToken: string;
  private wikirateApiUrl: string;
  private auth?: BasicAuth;

  private allowedMethods = ["post", "get", "delete"] as const;

  constructor(oauthToken: string, wikirateApiUrl: string = WIKIRATE_API_URL, auth?: BasicAuth) {
    this.oauthToken = oauthToken;
    this.wikirateApiUrl = wikirateApiUrl;
    this.auth = auth;
  }

  private get headers(): Record<string, string> {
    return {
      "X-API-Key": this.oauthToken,
    };
  }

  private buildAuthHeader(): string | undefined {
    if (!this.auth) return undefined;
    const { username, password } = this.auth;
    const token = Buffer.from(`${username}:${password}`).toString("base64");
    return `Basic ${token}`;
  }

  private async request({ method, path, headers = {}, params = {}, files = {} }: RequestOptions): Promise<Response> {
    const m = method.trim().toLowerCase();
    if (!this.allowedMethods.includes(m as any)) {
      throw new IllegalHttpMethod(`The '${method}' method is not accepted by the Wikirate client.`);
    }

    const url = new URL(formatPath(path, this.wikirateApiUrl));

    let fetchInit: RequestInit = { method: m.toUpperCase() };

    const baseHeaders: Record<string, string> = { ...headers };
    const authHeader = this.buildAuthHeader();
    if (authHeader) baseHeaders["Authorization"] = authHeader;

    // GET => querystring; POST/DELETE => form or multipart
    if (m === "get") {
      const usp = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        if (Array.isArray(v)) v.forEach((vv) => usp.append(k, String(vv)));
        else usp.append(k, String(v));
      });
      const qs = usp.toString();
      if (qs) url.search = qs;
    } else {
      const hasFiles = Object.keys(files ?? {}).length > 0;
      if (hasFiles) {
        const fd = new FormData();
        // params as regular fields
        Object.entries(params ?? {}).forEach(([k, v]) => {
          if (v === undefined || v === null) return;
          if (Array.isArray(v)) v.forEach((vv) => fd.append(k, String(vv)));
          else fd.append(k, String(v));
        });
        // files
        for (const [key, value] of Object.entries(files ?? {})) {
          if (typeof value === "string") {
            // treat as file path
            fd.append(key, createReadStream(value) as any);
          } else {
            fd.append(key, value as any);
          }
        }
        fetchInit.body = fd as any;
        // Let fetch set multipart boundary; don't set Content-Type manually
      } else {
        const usp = new URLSearchParams();
        Object.entries(params ?? {}).forEach(([k, v]) => {
          if (v === undefined || v === null) return;
          if (Array.isArray(v)) v.forEach((vv) => usp.append(k, String(vv)));
          else usp.append(k, String(v));
        });
        fetchInit.body = usp as any;
        baseHeaders["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
      }
    }

    fetchInit.headers = baseHeaders;

    let response: Response;
    try {
      response = await fetch(url, fetchInit);
    } catch (e: any) {
      throw new Wikirate4PyException(`Failed to send request: ${e?.message ?? e}`);
    }

    if (response.status === 400) throw new BadRequestException(response, await response.text());
    if (response.status === 401) throw new UnauthorizedException(response, await response.text());
    if (response.status === 403) throw new ForbiddenException(response, await response.text());
    if (response.status === 404) throw new NotFoundException(response, await response.text());
    if (response.status === 429) throw new TooManyRequestsException(response, await response.text());
    if (response.status >= 500) throw new WikirateServerErrorException(response, await response.text());
    if (response.status && !(response.status >= 200 && response.status < 300)) {
      throw new HTTPException(response, await response.text());
    }

    return response;
  }

  private getReq(path: string, params: Record<string, any> = {}): Promise<Response> {
    // remove explicit content-type for GET
    const headers = { ...this.headers };
    delete (headers as any)["content-type"];
    return this.request({ method: "get", path, headers, params });
  }

  private postReq(path: string, params: Record<string, any> = {}, files: Record<string, any> = {}): Promise<Response> {
    return this.request({ method: "post", path, headers: this.headers, params, files });
  }

  private deleteReq(path: string, params: Record<string, any> = {}): Promise<Response> {
    return this.request({ method: "delete", path, headers: this.headers, params });
  }

  /***********************
   * Filter builder
   ***********************/
  private buildFilters(kwargs: Record<string, any>, endpointParams: string[], filters: string[]): Record<string, any> {
    const params: Record<string, any> = {};
    for (const [k, arg] of Object.entries(kwargs)) {
      if (arg === undefined || arg === null) continue;
      if (!endpointParams.includes(k) && !filters.includes(k)) {
        // keep but warn (optionally log)
        // console.warn(`Unexpected parameter: ${k}`);
      }
      if (filters.includes(k)) {
        if (k === "value_from" || k === "value_to") {
          params[`filter[value][${k.split("_").pop()}]`] = String(arg);
        } else if (["subject_company_name", "object_company_name", "object_company_id", "subject_company_id"].includes(k)) {
          params[`filter[${k}][]`] = arg;
        } else if (k === "company") {
          if (Array.isArray(arg)) {
            for (const item of arg) {
              const v = typeof item === "number" ? `~${item}` : String(item);
              if (!params[`filter[${k}][]`]) params[`filter[${k}][]`] = [];
              params[`filter[${k}][]`].push(v);
            }
          } else {
            params[`filter[${k}][]`] = typeof arg === "string" ? arg : `~${arg}`;
          }
        } else if (k === "company_identifier") {
          params[`filter[company_identifier[value]]`] = Array.isArray(arg) ? (arg as any[]).join(", ") : String(arg);
        } else {
          if (Array.isArray(arg)) {
            for (const item of arg) {
              const isYear = k === "year";
              const v = typeof item === "number" && !isYear ? `~${item}` : String(item);
              if (!params[`filter[${k}][]`]) params[`filter[${k}][]`] = [];
              params[`filter[${k}][]`].push(v);
            }
          } else {
            const v = typeof arg === "number" && !["value", "year"].includes(k) ? `~${arg}` : String(arg);
            params[`filter[${k}]`] = v;
          }
        }
      } else {
        params[k] = String(arg);
      }
    }
    return params;
  }

  /***********************
   * Public API methods
   ***********************/
  async get_company(identifier: string | number): Promise<Company> {
    const res = await this.getReq(`/${buildCardIdentifier(identifier)}.json`);
    return res.json();
  }

  async get_companies(identifier?: string | number | null, kwargs: Record<string, any> = {}): Promise<CompanyItem[]> {
    const endpoint = constructEndpoint(identifier ?? null, "Companies");
    const params = this.buildFilters(
      kwargs,
      ["limit", "offset"],
      ["name", "company_category", "company_group", "country", "company_identifier"]
    );
    const res = await this.getReq(`/${endpoint}`, params);
    const payload = await res.json();
    return (payload?.items ?? []) as CompanyItem[];
  }

  async get_topic(identifier: string | number): Promise<Topic> {
    const res = await this.getReq(`/${buildCardIdentifier(identifier)}.json`);
    return res.json();
  }

  async get_topics(identifier?: string | number | null, kwargs: Record<string, any> = {}): Promise<TopicItem[]> {
    const endpoint = constructEndpoint(identifier ?? null, "Topics");
    const params = this.buildFilters(kwargs, ["limit", "offset"], ["name", "bookmark"]);
    const res = await this.getReq(`/${endpoint}`, params);
    const payload = await res.json();
    return (payload?.items ?? []) as TopicItem[];
  }

  async get_metric(identifier?: string | number | null, metric_name?: string, metric_designer?: string): Promise<Metric> {
    if (identifier == null) {
      if (!metric_name || !metric_designer) {
        throw new Wikirate4PyException(
          "You must provide either `identifier` or both `metric_name` and `metric_designer`."
        );
      }
    }
    const cardName =
      identifier != null
        ? buildCardIdentifier(identifier)
        : `${buildCardIdentifier(metric_designer!)}+${buildCardIdentifier(metric_name!)}`;
    const res = await this.getReq(`/${cardName}.json`);
    return res.json();
  }

  async get_metrics(identifier?: string | number | null, kwargs: Record<string, any> = {}): Promise<MetricItem[]> {
    const endpoint = constructEndpoint(identifier ?? null, "Metrics");
    const params = this.buildFilters(
      kwargs,
      ["limit", "offset"],
      ["bookmark", "topic", "designer", "published", "metric_type", "value_type", "metric_keyword", "research_policy", "dataset"]
    );
    const res = await this.getReq(`/${endpoint}`, params);
    const payload = await res.json();
    return (payload?.items ?? []) as MetricItem[];
  }

  async get_research_group(identifier: string | number): Promise<ResearchGroup> {
    const res = await this.getReq(`/${buildCardIdentifier(identifier)}.json`);
    return res.json();
  }

  async get_research_groups(kwargs: Record<string, any> = {}): Promise<ResearchGroupItem[]> {
    const params = this.buildFilters(kwargs, ["limit", "offset"], ["name"]);
    const res = await this.getReq("/Research_Groups.json", params);
    const payload = await res.json();
    return (payload?.items ?? []) as ResearchGroupItem[];
  }

  async get_company_group(identifier: string | number): Promise<CompanyGroup> {
    const res = await this.getReq(`/${buildCardIdentifier(identifier)}.json`);
    return res.json();
  }

  async get_company_groups(kwargs: Record<string, any> = {}): Promise<CompanyGroupItem[]> {
    const params = this.buildFilters(kwargs, ["limit", "offset"], ["name"]);
    const res = await this.getReq("/Company_Groups.json", params);
    const payload = await res.json();
    return (payload?.items ?? []) as CompanyGroupItem[];
  }

  async get_source(identifier: string | number): Promise<Source> {
    const res = await this.getReq(`/${buildCardIdentifier(identifier)}.json`);
    return res.json();
  }

  async get_sources(kwargs: Record<string, any> = {}): Promise<SourceItem[]> {
    const params = this.buildFilters(
      kwargs,
      ["limit", "offset"],
      ["name", "wikirate_title", "topic", "report_type", "year", "wikirate_link", "company"]
    );
    const res = await this.getReq("/Sources.json", params);
    const payload = await res.json();
    return (payload?.items ?? []) as SourceItem[];
  }

  async get_answer(identifier: string | number): Promise<Answer> {
    const res = await this.getReq(`/${buildCardIdentifier(identifier)}.json`);
    return res.json();
  }

  async get_answers(kwargs: Record<string, any> = {}): Promise<AnswerItem[]> {
    const { metric_name, metric_designer, identifier, ...rest } = kwargs;
    const endpoint = metric_name && metric_designer
      ? constructEndpoint(`${metric_designer}+${metric_name}`, "Answers")
      : constructEndpoint(identifier ?? null, "Answers");

    const params = this.buildFilters(
      rest,
      ["limit", "offset", "view"],
      [
        "year", "status", "company_group", "country", "value", "value_from", "value_to",
        "updated", "company", "company_keyword", "dataset", "updater", "source",
        "verification", "bookmark", "published", "metric_name", "metric_keyword", "designer",
        "metric_type", "company_identifier", "metric", "sort_by", "sort_dir"
      ]
    );
    const res = await this.getReq(`/${endpoint}`, params);
    const payload = await res.json();
    return (payload?.items ?? []) as AnswerItem[];
  }

  async get_relationship(identifier: string | number): Promise<Relationship> {
    const res = await this.getReq(`/${buildCardIdentifier(identifier)}.json`);
    return res.json();
  }

  async get_relationships(kwargs: Record<string, any> = {}): Promise<RelationshipItem[]> {
    const { metric_name, metric_designer, identifier, ...rest } = kwargs;
    const endpoint = metric_name && metric_designer
      ? constructEndpoint(`${metric_designer}+${metric_name}`, "Relationships")
      : constructEndpoint(identifier ?? null, "Relationships");

    const params = this.buildFilters(
      rest,
      ["limit", "offset"],
      [
        "year", "status", "company_group", "country", "value", "value_from", "value_to", "updated",
        "updater", "verification", "project", "bookmark", "published",
        "object_company_name", "subject_company_name", "object_company_id", "subject_company_id"
      ]
    );
    const res = await this.getReq(`/${endpoint}`, params);
    const payload = await res.json();
    return (payload?.items ?? []) as RelationshipItem[];
  }

  async get_project(identifier: string | number): Promise<Project> {
    const urlKey = typeof identifier === "string" ? generateUrlKey(identifier) : `~${identifier}`;
    const res = await this.getReq(`/${urlKey}.json`);
    return res.json();
  }

  async get_projects(kwargs: Record<string, any> = {}): Promise<ProjectItem[]> {
    const params = this.buildFilters(kwargs, ["limit", "offset"], ["name", "wikirate_status"]);
    const res = await this.getReq("/Projects.json", params);
    const payload = await res.json();
    return (payload?.items ?? []) as ProjectItem[];
  }

  async get_dataset(identifier: string | number): Promise<Dataset> {
    const urlKey = typeof identifier === "string" ? generateUrlKey(identifier) : `~${identifier}`;
    const res = await this.getReq(`/${urlKey}.json`);
    return res.json();
  }

  async get_datasets(kwargs: Record<string, any> = {}): Promise<DatasetItem[]> {
    const params = this.buildFilters(kwargs, ["limit", "offset"], ["name", "topic"]);
    const res = await this.getReq("/Datasets.json", params);
    const payload = await res.json();
    return (payload?.items ?? []) as DatasetItem[];
  }

  async get_regions(kwargs: Record<string, any> = {}): Promise<RegionItem[]> {
    const params = this.buildFilters(kwargs, ["limit", "offset"], []);
    const res = await this.getReq("/Region.json", params);
    const payload = await res.json();
    return (payload?.items ?? []) as RegionItem[];
  }

  async get_region(identifier: string | number): Promise<Region> {
    const urlKey = typeof identifier === "string" ? generateUrlKey(identifier) : `~${identifier}`;
    const res = await this.getReq(`/${urlKey}.json`);
    return res.json();
  }

  async search_by_name(
    entity: "Company" | "Metric" | "Topic" | "CompanyGroup" | "ResearchGroup" | "Project",
    name: string,
    kwargs: Record<string, any> = {}
  ): Promise<any[]> {
    switch (entity) {
      case "Company":
        return this.get_companies(undefined, { ...kwargs, name });
      case "Metric":
        return this.get_metrics(undefined, { ...kwargs, metric_keyword: name });
      case "Topic":
        return this.get_topics(undefined, { ...kwargs, name });
      case "CompanyGroup":
        return this.get_company_groups({ ...kwargs, name });
      case "ResearchGroup":
        return this.get_research_groups({ ...kwargs, name });
      case "Project":
        return this.get_projects({ ...kwargs, name });
      default:
        throw new Wikirate4PyException(`Type of parameter 'entity' (${entity}) is not allowed`);
    }
  }

  async search_source_by_url(url: string, kwargs: Record<string, any> = {}): Promise<SourceItem[]> {
    const params = { "query[url]": url, ...kwargs };
    const res = await this.getReq("/Source_by_url.json", params);
    const payload = await res.json();
    return (payload?.items ?? []) as SourceItem[];
  }

  async add_company(name: string, headquarters: string, kwargs: Record<string, any> = {}): Promise<Company> {
    if (!name || !headquarters) {
      throw new Wikirate4PyException("Both 'name' and 'headquarters' are required to create a company.");
    }

    const optional = new Set([
      "open_supply_id",
      "wikipedia",
      "website",
      "open_corporates_id",
      "international_securities_identification_number",
      "legal_entity_identifier",
      "sec_central_index_key",
      "uk_company_number",
      "australian_business_number",
    ]);

    const params: Record<string, any> = {
      "card[type]": "Company",
      "card[name]": name,
      "card[subcards][+headquarters]": headquarters,
      confirmed: "true",
      format: "json",
      "success[format]": "json",
    };

    for (const [k, v] of Object.entries(kwargs)) {
      if (v == null || !optional.has(k)) continue;
      params[`card[subcards][+${k}]`] = Array.isArray(v) ? v.join("\n") : String(v);
    }

    if (!("open_corporates_id" in kwargs)) {
      params["card[skip]"] = "update_oc_mapping_due_to_headquarters_entry";
    }

    const res = await this.postReq("/card/create", params);
    return res.json();
  }

  async update_company(identifier: string | number, kwargs: Record<string, any> = {}): Promise<Company> {
    if (!identifier) {
      throw new Wikirate4PyException(
        "A Wikirate company is defined by its identifier. Please provide a valid company identifier or name."
      );
    }

    const optional = new Set([
      "headquarters",
      "open_supply_id",
      "wikipedia",
      "website",
      "open_corporates_id",
      "international_securities_identification_number",
      "legal_entity_identifier",
      "sec_central_index_key",
      "uk_company_number",
      "australian_business_number",
    ]);

    const params: Record<string, any> = {
      "card[type]": "Company",
      format: "json",
      "success[format]": "json",
    };

    for (const [k, v] of Object.entries(kwargs)) {
      if (v == null || !optional.has(k)) continue;
      params[`card[subcards][+${k}]`] = Array.isArray(v) ? v.join("\n") : String(v);
    }

    const urlKey = typeof identifier === "string" ? generateUrlKey(identifier) : `~${identifier}`;
    const res = await this.postReq(`/update/${urlKey}`, params);
    return res.json();
  }

  async add_answer(kwargs: Record<string, any>): Promise<Answer> {
    const required = ["metric_designer", "metric_name", "company", "year", "value", "source"];
    const missing = required.filter((k) => !(k in kwargs));
    if (missing.length) throw new Wikirate4PyException(`Invalid set of params! Missing required params: ${missing.join(", ")}`);

    const name = `${kwargs.metric_designer}+${kwargs.metric_name}+${buildCardIdentifier(kwargs.company)}+${kwargs.year}`;

    const params: Record<string, any> = {
      "card[type]": "Answer",
      "card[name]": name,
      "card[subcards][+:value]": Array.isArray(kwargs.value) ? kwargs.value.join("\n") : String(kwargs.value),
      "card[subcards][+:source]": Array.isArray(kwargs.source) ? kwargs.source.join("\n") : String(kwargs.source),
      format: "json",
      "success[format]": "json",
    };

    if (kwargs.comment != null) params["card[subcards][+:discussion]"] = String(kwargs.comment);
    if (kwargs.unpublished != null) params["card[subcards][+:unpublished]"] = String(kwargs.unpublished);

    const res = await this.postReq("/card/create", params);
    return res.json();
  }

  async update_answer(kwargs: Record<string, any>): Promise<Answer> {
    const required = ["metric_designer", "metric_name", "company", "year"];
    if (!("identifier" in kwargs) && !required.every((k) => kwargs[k] != null)) {
      throw new Wikirate4PyException(
        `Invalid set of params! You need to provide either \`identifier\` or all of the following: ${required.join(", ")}.`
      );
    }

    const cardName = "identifier" in kwargs
      ? `~${kwargs.identifier}`
      : `${generateUrlKey(kwargs.metric_designer)}+${generateUrlKey(kwargs.metric_name)}+${buildCardIdentifier(kwargs.company)}+${kwargs.year}`;

    const params: Record<string, any> = {
      "card[type]": "Answer",
      "card[name]": cardName,
      format: "json",
      "success[format]": "json",
    };

    const optional = ["value", "company", "year", "source", "comment", "unpublished"];
    for (const k of optional) {
      const v = kwargs[k];
      if (v == null) continue;
      const subKey = k === "comment" ? "discussion" : k;
      params[`card[subcards][+:${subKey}]`] = Array.isArray(v) ? v.join("\n") : String(v);
    }

    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async update_card(identifier: number | string, kwargs: { json: string }): Promise<any> {
    if (!kwargs?.json) {
      throw new Wikirate4PyException("Invalid set of params! You need to define 'json' to update the research answer.");
    }
    const params: Record<string, any> = {
      "card[name]": `~${identifier}`,
      "card[content]": kwargs.json,
      format: "json",
      "success[format]": "json",
    };
    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async add_relationship(kwargs: Record<string, any>): Promise<Relationship> {
    const required = ["metric_designer", "metric_name", "subject_company", "object_company", "year", "value", "source"];
    for (const k of required) {
      if (!(k in kwargs) || kwargs[k] == null) throw new Wikirate4PyException(`Invalid set of params! Missing required param: ${k}`);
    }

    const cardName = [
      buildCardIdentifier(kwargs.metric_designer),
      buildCardIdentifier(kwargs.metric_name),
      buildCardIdentifier(kwargs.subject_company),
      String(kwargs.year),
      buildCardIdentifier(kwargs.object_company),
    ].join("+");

    const params: Record<string, any> = {
      "card[type]": "Relationship",
      "card[name]": cardName,
      "card[subcards][+:value]": Array.isArray(kwargs.value) ? kwargs.value.join("\n") : String(kwargs.value),
      "card[subcards][+:source]": Array.isArray(kwargs.source) ? kwargs.source.join("\n") : String(kwargs.source),
      format: "json",
      "success[format]": "json",
    };

    if (kwargs.comment != null) params["card[subcards][+:discussion]"] = String(kwargs.comment);

    const res = await this.postReq("/card/create", params);
    return res.json();
  }

  async add_metric(kwargs: Record<string, any>): Promise<Metric> {
    const required = ["designer", "name", "metric_type", "value_type"];
    for (const k of required) if (!(k in kwargs)) {
      throw new Wikirate4PyException(
        `Invalid set of params! You need to define all required params to create a metric: ${required.join(", ")}`
      );
    }

    const params: Record<string, any> = {
      "card[type]": "Metric",
      "card[name]": `${kwargs.designer}+${kwargs.name}`,
      "card[subcards][+value_type]": kwargs.value_type,
      "card[subcards][+*metric_type]": kwargs.metric_type,
      "card[skip]": "requirements",
      format: "json",
      "success[format]": "json",
    };

    const optional = [
      "question",
      "about",
      "methodology",
      "unit",
      "topics",
      "value_options",
      "research_policy",
      "report_type",
    ];

    for (const k of optional) {
      if (!(k in kwargs)) continue;
      const v = kwargs[k];
      params[`card[subcards][+${k}]`] = Array.isArray(v) ? v.join("\n") : String(v);
    }

    const res = await this.postReq("/card/create", params);
    return res.json();
  }

  async update_metric(identifier: number | string, kwargs: Record<string, any> = {}): Promise<Metric> {
    const params: Record<string, any> = {
      "card[type]": "Metric",
      "card[skip]": "requirements",
      format: "json",
      "success[format]": "json",
    };

    const optional = [
      "metric_type",
      "value_type",
      "question",
      "about",
      "methodology",
      "unit",
      "topics",
      "value_options",
      "research_policy",
      "report_type",
      "unpublished",
    ];

    for (const k of optional) {
      if (!(k in kwargs)) continue;
      const v = kwargs[k];
      params[`card[subcards][+${k}]`] = Array.isArray(v) ? v.join("\n") : String(v);
    }

    const res = await this.postReq(`/update/~${identifier}`, params);
    return res.json();
  }

  async update_relationship(kwargs: Record<string, any>): Promise<Relationship> {
    const required = ["metric_designer", "metric_name", "subject_company", "year", "object_company"];
    if (!("identifier" in kwargs) && !required.every((k) => kwargs[k] != null)) {
      throw new Wikirate4PyException(
        `Invalid set of params! You need to provide either \`identifier\` or all of the following: ${required.join(", ")}.`
      );
    }

    const cardName = "identifier" in kwargs
      ? `~${kwargs.identifier}`
      : [
          buildCardIdentifier(kwargs.metric_designer),
          buildCardIdentifier(kwargs.metric_name),
          buildCardIdentifier(kwargs.subject_company),
          String(kwargs.year),
          buildCardIdentifier(kwargs.object_company),
        ].join("+");

    const params: Record<string, any> = {
      "card[type]": "Relationship",
      "card[name]": cardName,
      format: "json",
      "success[format]": "json",
    };

    const optional = ["year", "value", "source", "comment"] as const;
    for (const k of optional) {
      const v = kwargs[k];
      if (v == null) continue;
      const subKey = k === "comment" ? "discussion" : k;
      params[`card[subcards][+:${subKey}]`] = Array.isArray(v) ? v.join("\n") : String(v);
    }

    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async add_source(kwargs: Record<string, any>): Promise<Source> {
    const required = ["title"];
    const missing = required.filter((k) => !(k in kwargs));
    if (missing.length) throw new Wikirate4PyException(`Invalid set of params! Missing required params: ${missing.join(", ")}`);

    if (!("link" in kwargs) && !("file" in kwargs)) {
      throw new Wikirate4PyException("You must provide either a 'link' or a 'file' to create a source.");
    }

    const params: Record<string, any> = {
      "card[type]": "Source",
      "card[subcards][+title]": kwargs.title,
      "card[skip]": "requirements",
      format: "json",
      "success[format]": "json",
    };

    const files: Record<string, any> = {};

    for (const [k, v] of Object.entries(kwargs)) {
      if (v == null) continue;
      if (k === "file") {
        const path = String(v);
        if (!existsSync(path)) throw new Wikirate4PyException(`File not found at path: ${path}`);
        files["card[subcards][+file][file]"] = path; // will be turned into stream in request()
      } else if (["link", "company", "report_type", "year"].includes(k)) {
        const key = `card[subcards][+${k}]`;
        params[key] = k === "company" && typeof v === "number" ? `~${v}` : String(v);
      }
    }

    const res = await this.postReq("/card/create", params, files);
    return res.json();
  }

  async upload_source_file(source: string, file: string): Promise<Source> {
    if (!existsSync(file)) throw new Wikirate4PyException(`File not found at path: ${file}`);
    const params: Record<string, any> = { format: "json", "success[format]": "json" };
    const files: Record<string, any> = { "card[subcards][+file][file]": file };
    const res = await this.postReq(`/update/${source}`, params, files);
    return res.json();
  }

  async update_source(kwargs: Record<string, any>): Promise<Source> {
    if (!("name" in kwargs)) {
      throw new Wikirate4PyException("Invalid set of params! Missing required param: name");
    }

    const params: Record<string, any> = {
      "card[type]": "Source",
      "card[name]": kwargs.name,
      "card[skip]": "requirements",
      format: "json",
      "success[format]": "json",
    };

    for (const k of ["title", "company", "report_type", "year"]) {
      const v = kwargs[k];
      if (v == null) continue;
      const key = `card[subcards][+${k}]`;
      params[key] = k === "company" && typeof v === "number" ? `~${v}` : String(v);
    }

    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async delete_wikirate_entity(identifier: number): Promise<boolean> {
    if (!Number.isInteger(identifier) || identifier <= 0) {
      throw new Wikirate4PyException(`Invalid id: ${identifier}. It must be a positive integer.`);
    }
    const res = await this.deleteReq(`/~${identifier}`);
    return res.status === 200;
  }

  async add_companies_to_group(group_id: string | number, list: Array<string>): Promise<any> {
    const ids = list.map((item) => `~[[${item}]]`).join("\n");
    const params: Record<string, any> = {
      "card[type]": "List",
      "card[name]": `${buildCardIdentifier(group_id)}+Company`,
      "card[content]": ids,
      format: "json",
      "success[format]": "json",
    };
    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async add_companies_to_dataset(dataset_id: number | string, list: Array<number | string>): Promise<any> {
    const ids = list.map((item) => `~${String(item)}`);
    const params: Record<string, any> = {
      "card[type]": "List",
      "card[name]": `~${String(dataset_id)}+Company`,
      "add_item[]": ids,
      format: "json",
      "success[format]": "json",
    };
    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async add_metrics_to_dataset(dataset_id: number | string, list: Array<string | number>): Promise<any> {
    const ids = list.map((item) => `~[[${String(item)}]]`).join("\n");
    const params: Record<string, any> = {
      "card[type]": "List",
      "card[name]": `~${String(dataset_id)}+Metric`,
      "card[content]": ids,
      format: "json",
      "success[format]": "json",
    };
    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async verify_answer(identifier: number | string): Promise<any> {
    const params: Record<string, any> = {
      "card[type]": "List",
      "card[name]": `~${identifier}+checked_by`,
      "card[trigger]": "add_check",
      format: "json",
      "success[format]": "json",
    };
    const res = await this.postReq("/card/update", params);
    return res.json();
  }

  async get_comments(identifier: number | string): Promise<string> {
    const res = await this.getReq(`/~${identifier}+discussion.json`);
    const json = await res.json();
    return json?.content ?? "";
  }

  async get_content(identifier: string | number): Promise<string> {
    const res = await this.getReq(`/${identifier}.json`);
    const json = await res.json();
    return json?.content ?? "";
  }
}

export default API;
