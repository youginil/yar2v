import os from 'os';
import path from 'path';

export const DataDir = path.join(os.homedir(), '.yar2v');

export const MaxTesting = 10;

export const HttpInboundTag = 'user-http';
export const SockInboundTag = 'user-socks';
export const OutboundTag = 'remote';
export const TestingTagPrefix = 'test-';
