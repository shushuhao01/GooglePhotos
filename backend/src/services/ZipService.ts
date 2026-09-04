import { randomBytes } from 'node:crypto';
import { AppDataSource } from '../config/database.js';
import { ZipJob } from '../entities/ZipJob.js';
import { EntitlementService } from './EntitlementService.js';
import { AppError } from '../utils/response.js';

const zipRepo = () => AppDataSource.getRepository(ZipJob);

export class ZipService {
  /* 创建 ZIP 任务：服务端抓取并打包，预扣 zip 额度 */
  async createJob(userId: number, files: string[]) {
    if (!Array.isArray(files) || !files.length || files.length > 100) throw new AppError(400, 'INVALID_FILE_COUNT', '文件数量不合法');
    const period = new Date().toISOString().slice(0, 7);
    const reqId = 'ZIPRES_' + randomBytes(6).toString('hex');
    await new EntitlementService().reserve(userId, 'zip', reqId);
    const jobNo = 'ZIP' + Date.now().toString(36).toUpperCase() + randomBytes(4).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const job = await zipRepo().save({ jobNo, userId, status: 'queued', fileCount: files.length, expiresAt });
    // 异步处理（简化：模拟抓取完成并生成占位下载地址；生产应接队列 worker）
    this.processJob(job.jobNo).catch(() => {});
    return { jobNo: job.jobNo, status: 'queued' };
  }

  private async processJob(jobNo: string) {
    const job = await zipRepo().findOne({ where: { jobNo } });
    if (!job) return;
    await zipRepo().update({ id: job.id }, { status: 'running' });
    // 注：真正打包需从上游 URL 抓取；此处保留任务状态机，下载地址由上级填充
    await zipRepo().update({ id: job.id }, { status: 'completed', totalBytes: 0, downloadUrl: `/api/v1/zip/jobs/${jobNo}/download` });
  }

  async getJob(userId: number, jobNo: string) {
    const job = await zipRepo().findOne({ where: { jobNo, userId } });
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', '任务不存在');
    return job;
  }
}

export const zipService = new ZipService();
