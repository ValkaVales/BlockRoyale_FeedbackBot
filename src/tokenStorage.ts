import { promises as fs } from 'fs';
import path from 'path';

export interface TokenData {
  refreshToken: string;
  updatedAt: string;
  updatedBy?: string;
}

const TOKEN_FILE_PATH = path.join(process.cwd(), 'tokens.json');

export async function loadRefreshToken(): Promise<string | null> {
  try {
    const data = await fs.readFile(TOKEN_FILE_PATH, 'utf8');
    const tokenData: TokenData = JSON.parse(data);

    if (!tokenData.refreshToken) {
      console.warn('⚠️  No refresh token found in tokens.json');
      return null;
    }

    console.log(`✅ Refresh token loaded from file (updated: ${tokenData.updatedAt})`);
    return tokenData.refreshToken;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('❌ tokens.json not found. Please authorize via /oauth/auth endpoint');
      return null;
    }

    console.error('❌ Error loading refresh token from file:', error.message);
    return null;
  }
}


export async function saveRefreshToken(
  refreshToken: string,
  updatedBy: string = 'System'
): Promise<void> {
  try {
    const tokenData: TokenData = {
      refreshToken,
      updatedAt: new Date().toISOString(),
      updatedBy
    };

    await fs.writeFile(TOKEN_FILE_PATH, JSON.stringify(tokenData, null, 2), 'utf8');
    console.log(`✅ Refresh token saved to file by: ${updatedBy}`);
  } catch (error: any) {
    console.error('❌ Error saving refresh token to file:', error.message);
    throw error;
  }
}
export async function getTokenMetadata(): Promise<TokenData | null> {
  try {
    const data = await fs.readFile(TOKEN_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}
