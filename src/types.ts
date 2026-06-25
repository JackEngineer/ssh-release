export type DeployMode = 'release' | 'overwrite';

export type CompressionFormat = 'tgz';

export interface SshReleaseConfig {
  source: {
    path: string;
    exclude: string[];
  };
  server: {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    password?: string;
  };
  target: {
    path: string;
    currentSymlink: string;
    releasesDir: string;
    tempDir: string;
  };
  deploy: {
    mode: DeployMode;
    keepReleases: number;
    compression: CompressionFormat;
    preferTar: boolean;
    fallbackToFileUpload: boolean;
  };
}

export interface SshReleaseConfigInput {
  source?: {
    path?: string;
    exclude?: string[];
  };
  server?: {
    host?: string;
    port?: number;
    username?: string;
    privateKeyPath?: string;
    password?: string;
  };
  target?: {
    path?: string;
    currentSymlink?: string;
    releasesDir?: string;
    tempDir?: string;
  };
  deploy?: {
    mode?: string;
    keepReleases?: number;
    compression?: string;
    preferTar?: boolean;
    fallbackToFileUpload?: boolean;
  };
}
