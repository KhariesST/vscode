/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';

export interface ICustomAgentData {
	readonly name: string;
	readonly repo_owner_id: number;
	readonly repo_owner: string;
	readonly repo_id: number;
	readonly repo_name: string;
	readonly display_name: string;
	readonly description: string;
	readonly tools: string[];
	readonly argument_hint?: string;
	readonly metadata?: Record<string, string | number>;
	readonly version: string;
	readonly 'mcp-servers'?: Record<string, unknown>;
	readonly target?: string;
	readonly config_error?: string;
}

export interface ICustomAgentsResponse {
	readonly agents: ICustomAgentData[];
}

export interface ICustomAgentsQueryOptions {
	readonly target?: 'github-copilot' | 'vscode';
	readonly exclude_invalid_config?: boolean;
	readonly dedupe?: boolean;
	readonly include_sources?: string;
}

export const ICustomAgentsService = createDecorator<ICustomAgentsService>('customAgentsService');

export interface ICustomAgentsService {
	readonly _serviceBrand: undefined;

	/**
	 * Fetch custom agents for the current repository
	 */
	fetchCustomAgents(options?: ICustomAgentsQueryOptions, token?: CancellationToken): Promise<ICustomAgentData[]>;

	/**
	 * Fetch custom agents for a specific repository
	 */
	fetchCustomAgentsForRepo(repoOwner: string, repoName: string, options?: ICustomAgentsQueryOptions, token?: CancellationToken): Promise<ICustomAgentData[]>;
}

export class CustomAgentsService extends Disposable implements ICustomAgentsService {
	declare readonly _serviceBrand: undefined;

	private readonly customAgentsBaseUrl: string;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IProductService private readonly productService: IProductService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		super();
		// Use the custom agents API URL from product configuration
		this.customAgentsBaseUrl = this.productService.defaultChatAgent?.customAgentsUrl ?? 'https://api.githubcopilot.com/agents/swe/custom-agents';
	}

	async fetchCustomAgents(options?: ICustomAgentsQueryOptions, token: CancellationToken = CancellationToken.None): Promise<ICustomAgentData[]> {
		// Try to detect the repository from the workspace
		const repoInfo = await this.getRepositoryInfo();
		if (!repoInfo) {
			this.logService.warn('CustomAgentsService: No repository information found in workspace');
			return [];
		}

		return this.fetchCustomAgentsForRepo(repoInfo.owner, repoInfo.name, options, token);
	}

	async fetchCustomAgentsForRepo(repoOwner: string, repoName: string, options?: ICustomAgentsQueryOptions, token: CancellationToken = CancellationToken.None): Promise<ICustomAgentData[]> {
		try {
			// Get GitHub authentication session
			const sessions = await this.authenticationService.getSessions('github');
			if (!sessions || sessions.length === 0) {
				this.logService.warn('CustomAgentsService: No GitHub authentication session found');
				return [];
			}

			const accessToken = sessions[0].accessToken;

			// Build query parameters
			const queryParams = new URLSearchParams();
			if (options?.target) {
				queryParams.append('target', options.target);
			}
			if (options?.exclude_invalid_config !== undefined) {
				queryParams.append('exclude_invalid_config', String(options.exclude_invalid_config));
			}
			if (options?.dedupe !== undefined) {
				queryParams.append('dedupe', String(options.dedupe));
			}
			if (options?.include_sources) {
				queryParams.append('include_sources', options.include_sources);
			}

			const url = `${this.customAgentsBaseUrl}/${repoOwner}/${repoName}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

			this.logService.debug('CustomAgentsService: Fetching custom agents from', url);

			const response = await this.requestService.request({
				type: 'GET',
				url,
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Accept': 'application/json'
				}
			}, token);

			if (response.res.statusCode !== 200) {
				this.logService.error('CustomAgentsService: Failed to fetch custom agents', response.res.statusCode);
				return [];
			}

			const result = await asJson<ICustomAgentsResponse>(response);
			if (!result || !result.agents) {
				this.logService.warn('CustomAgentsService: Invalid response format');
				return [];
			}

			this.logService.info(`CustomAgentsService: Fetched ${result.agents.length} custom agents`);
			return result.agents;
		} catch (error) {
			this.logService.error('CustomAgentsService: Error fetching custom agents', error);
			return [];
		}
	}

	private async getRepositoryInfo(): Promise<{ owner: string; name: string } | undefined> {
		try {
			// For now, hardcode vscode repo for testing
			// TODO: Properly implement git extension API access
			return { owner: 'microsoft', name: 'vscode' };
		} catch (error) {
			this.logService.error('CustomAgentsService: Error getting repository info', error);
			return undefined;
		}
	}
}
