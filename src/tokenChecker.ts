import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class TokenChecker {
  private oauth2Client: OAuth2Client;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URL
    );

    this.oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
  }

  /**
   * Comprehensive token status check
   */
  async checkTokenStatus(): Promise<{
    isValid: boolean;
    tokenInfo?: any;
    userInfo?: any;
    quotaInfo?: any;
    error?: string;
  }> {
    try {
      const { token: accessToken } = await this.oauth2Client.getAccessToken();
      
      if (!accessToken) {
        return {
          isValid: false,
          error: 'Unable to get access token from refresh token'
        };
      }

      const tokenInfoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
      const tokenInfo = await tokenInfoResponse.json() as any;

      if (!tokenInfoResponse.ok) {
        return {
          isValid: false,
          error: `Token validation failed: ${tokenInfo?.error_description || 'Unknown error'}`
        };
      }

      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      const profileResponse = await gmail.users.getProfile({ userId: 'me' });

      const oauth2Service = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const userInfoResponse = await oauth2Service.userinfo.get();

      const quotaInfo = await this.checkQuotaUsage();

      return {
        isValid: true,
        tokenInfo: {
          scope: tokenInfo?.scope || 'Unknown',
          expiresIn: tokenInfo?.expires_in || 'Unknown',
          audience: tokenInfo?.aud || 'Unknown',
          issuedAt: tokenInfo?.iat ? new Date(parseInt(tokenInfo.iat) * 1000).toISOString() : 'Unknown'
        },
        userInfo: {
          email: userInfoResponse.data.email,
          name: userInfoResponse.data.name,
          verified: userInfoResponse.data.verified_email,
          picture: userInfoResponse.data.picture
        },
        quotaInfo
      };

    } catch (error: any) {
      return {
        isValid: false,
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Check approximate quota usage
   */
  private async checkQuotaUsage(): Promise<any> {
    try {
      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      
      const startTime = Date.now();
      await gmail.users.getProfile({ userId: 'me' });
      const responseTime = Date.now() - startTime;

      return {
        responseTimeMs: responseTime,
        estimatedDailyLimit: 1000000000, // 1B requests per day
        estimatedEmailLimit: 1000, // 1K emails per day (estimated)
        rateLimitStatus: responseTime < 1000 ? 'good' : 'slow'
      };
    } catch (error) {
      return {
        error: 'Unable to check quota usage'
      };
    }
  }

  /**
   * Get token age and usage statistics
   */
  async getTokenAge(): Promise<{
    refreshTokenAge?: string;
    lastUsed?: string;
    estimatedExpiry?: string;
  }> {
    try {
      const { token } = await this.oauth2Client.getAccessToken();
      
      if (!token) {
        return { refreshTokenAge: 'Unable to determine - token invalid' };
      }

      try {
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(String(Buffer.from(tokenParts[1], 'base64')));
          const issuedAt = new Date(payload.iat * 1000);
          const expiresAt = new Date(payload.exp * 1000);
          
          return {
            lastUsed: new Date().toISOString(),
            refreshTokenAge: `Access token issued: ${issuedAt.toISOString()}`,
            estimatedExpiry: `Access token expires: ${expiresAt.toISOString()}`
          };
        }
      } catch (jwtError) {
      }

      return {
        lastUsed: new Date().toISOString(),
        refreshTokenAge: 'Unable to determine exact age - refresh token format not readable'
      };

    } catch (error: any) {
      return {
        refreshTokenAge: `Error: ${error.message}`
      };
    }
  }

  /**
   * Test token longevity with multiple API calls
   */
  async testTokenLongevity(): Promise<{
    totalTests: number;
    successfulTests: number;
    failedTests: number;
    averageResponseTime: number;
    errors: string[];
  }> {
    const results = {
      totalTests: 5,
      successfulTests: 0,
      failedTests: 0,
      averageResponseTime: 0,
      errors: [] as string[]
    };

    const responseTimes: number[] = [];

    for (let i = 0; i < results.totalTests; i++) {
      try {
        const startTime = Date.now();
        
        const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
        await gmail.users.getProfile({ userId: 'me' });
        
        const responseTime = Date.now() - startTime;
        responseTimes.push(responseTime);
        results.successfulTests++;

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: any) {
        results.failedTests++;
        results.errors.push(error.message);
      }
    }

    results.averageResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0;

    return results;
  }
}

/**
 * Quick token check endpoint
 */
export async function quickTokenCheck(): Promise<any> {
  const checker = new TokenChecker();
  
  const [status, age, longevity] = await Promise.all([
    checker.checkTokenStatus(),
    checker.getTokenAge(),
    checker.testTokenLongevity()
  ]);

  return {
    timestamp: new Date().toISOString(),
    tokenStatus: status,
    tokenAge: age,
    longevityTest: longevity,
    recommendations: generateRecommendations(status, longevity)
  };
}

function generateRecommendations(status: any, longevity: any): string[] {
  const recommendations: string[] = [];

  if (!status.isValid) {
    recommendations.push('❌ Token is invalid - immediate re-authorization required');
    recommendations.push('🔗 Visit /oauth/auth to get new token');
  } else {
    recommendations.push('✅ Token is currently working');
  }

  if (longevity.failedTests > 0) {
    recommendations.push(`⚠️ ${longevity.failedTests} out of ${longevity.totalTests} API calls failed`);
  }

  if (longevity.averageResponseTime > 2000) {
    recommendations.push('🐌 API response time is slow - possible quota issues');
  }

  if (status.isValid && longevity.successfulTests === longevity.totalTests) {
    recommendations.push('🚀 Token health is excellent');
    recommendations.push('📅 No immediate action needed');
  }

  return recommendations;
}