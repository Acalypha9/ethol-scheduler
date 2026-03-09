import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Request } from 'express';
import { EtholService } from './ethol.service';
import { LoginDto } from './dto/login.dto';
import { SyncService } from '../sync/sync.service';

@Controller()
export class EtholController {
  constructor(
    private readonly etholService: EtholService,
    @Inject(forwardRef(() => SyncService)) private readonly syncService: SyncService,
  ) {}

  private extractProxyPath(req: Request): string {
    const params = req.params as Record<string, string | string[] | undefined>;
    const wildcardPath = params.path ?? params[0];

    if (Array.isArray(wildcardPath)) {
      return wildcardPath.join('/');
    }

    if (typeof wildcardPath === 'string' && wildcardPath.length > 0) {
      return wildcardPath;
    }

    return req.url.replace(/^\/api\/proxy\//, '').split('?')[0];
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    try {
      await this.etholService.login(loginDto.email, loginDto.password);
      const token = this.etholService.getAuthToken();
      if (!token) {
        throw new Error('ETHOL login did not produce a usable token');
      }
      await this.syncService.triggerBootstrapFromToken(token);
      return {
        success: true,
        message: 'Logged in, session saved, and initial sync started',
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Login failed';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('logout')
  logout() {
    this.etholService.clearAuth();
    return { success: true, message: 'Logged out' };
  }

  @Get('schedule')
  async getSchedule() {
    try {
      if (!this.etholService.isLoggedIn()) {
        throw new HttpException(
          { success: false, error: 'Not logged in. Please login first.' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      const schedules = await this.etholService.getScheduleDataFromDb();
      return {
        success: true,
        data: schedules,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const message =
        error instanceof Error
          ? error.message
          : 'Failed to fetch schedule';

      // If session expired, signal 401
      if (
        message.includes('expired') ||
        message.includes('not logged in') ||
        message.includes('Not logged in')
      ) {
        throw new HttpException(
          { success: false, error: message },
          HttpStatus.UNAUTHORIZED,
        );
      }

      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('homework')
  async getHomework() {
    try {
      if (!this.etholService.isLoggedIn()) {
        throw new HttpException(
          { success: false, error: 'Not logged in. Please login first.' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      const homework = await this.etholService.getHomeworkFromDb();
      return {
        success: true,
        data: homework,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const message =
        error instanceof Error
          ? error.message
          : 'Failed to fetch homework';

      if (
        message.includes('expired') ||
        message.includes('not logged in') ||
        message.includes('Not logged in')
      ) {
        throw new HttpException(
          { success: false, error: message },
          HttpStatus.UNAUTHORIZED,
        );
      }

      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('attendance')
  async getAttendance() {
    try {
      if (!this.etholService.isLoggedIn()) {
        throw new HttpException(
          { success: false, error: 'Not logged in. Please login first.' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      const attendance = await this.etholService.getAttendanceFromDb();
      return {
        success: true,
        data: attendance,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const message =
        error instanceof Error
          ? error.message
          : 'Failed to fetch attendance';

      if (
        message.includes('expired') ||
        message.includes('not logged in') ||
        message.includes('Not logged in')
      ) {
        throw new HttpException(
          { success: false, error: message },
          HttpStatus.UNAUTHORIZED,
        );
      }

      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  // ── Generic ETHOL Proxy ──────────────────────────────────────
  // Proxies any ETHOL API path for lecturer/admin/BAAK/kaprodi endpoints
  // Usage: GET  /api/proxy/presensi/daftar-mahasiswa-hadir-kuliah?key=abc
  //        POST /api/proxy/presensi/buka  body: { kuliah: 1, dosen: 2, ... }

  private ensureLoggedIn() {
    if (!this.etholService.isLoggedIn()) {
      throw new HttpException(
        { success: false, error: 'Not logged in. Please login first.' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private handleProxyError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const message =
      error instanceof Error ? error.message : 'Proxy request failed';
    if (
      message.includes('expired') ||
      message.includes('not logged in') ||
      message.includes('Not logged in')
    ) {
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.UNAUTHORIZED,
      );
    }
    throw new HttpException(
      { success: false, error: message },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('proxy/*path')
  async proxyGet(@Req() req: Request) {
    try {
      this.ensureLoggedIn();
      const path = this.extractProxyPath(req);
      const query = req.query as Record<string, string>;
      const data = await this.etholService.proxyRequest('GET', path, query);
      return { success: true, data };
    } catch (error) {
      this.handleProxyError(error);
    }
  }

  @Post('proxy/*path')
  async proxyPost(@Req() req: Request, @Body() body: unknown) {
    try {
      this.ensureLoggedIn();
      const path = this.extractProxyPath(req);
      const query = req.query as Record<string, string>;
      const data = await this.etholService.proxyRequest('POST', path, query, body);
      return { success: true, data };
    } catch (error) {
      this.handleProxyError(error);
    }
  }

  @Put('proxy/*path')
  async proxyPut(@Req() req: Request, @Body() body: unknown) {
    try {
      this.ensureLoggedIn();
      const path = this.extractProxyPath(req);
      const query = req.query as Record<string, string>;
      const data = await this.etholService.proxyRequest('PUT', path, query, body);
      return { success: true, data };
    } catch (error) {
      this.handleProxyError(error);
    }
  }

  @Delete('proxy/*path')
  async proxyDelete(@Req() req: Request) {
    try {
      this.ensureLoggedIn();
      const path = this.extractProxyPath(req);
      const query = req.query as Record<string, string>;
      const data = await this.etholService.proxyRequest('DELETE', path, query);
      return { success: true, data };
    } catch (error) {
      this.handleProxyError(error);
    }
  }

  @Get('token')
  getToken() {
    this.ensureLoggedIn();
    const token = this.etholService.getAuthToken();
    return { success: true, token };
  }

  @Get('mis-schedule')
  async getMisSchedule(
    @Query('tahun') tahun?: string,
    @Query('semester') semester?: string,
  ) {
    try {
      this.ensureLoggedIn();

      const activePeriod = this.etholService.getCurrentAcademicPeriod();
      const parsedTahun = tahun ? Number(tahun) : activePeriod.tahun;
      const parsedSemester = semester ? Number(semester) : activePeriod.semester;

      if (!Number.isFinite(parsedTahun) || !Number.isFinite(parsedSemester)) {
        throw new HttpException(
          {
            success: false,
            error: 'tahun and semester must be valid numbers.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const data = await this.etholService.getMisSchedule(
        parsedTahun,
        parsedSemester,
      );
      return { success: true, data };
    } catch (error) {
      this.handleProxyError(error);
    }
  }
}
