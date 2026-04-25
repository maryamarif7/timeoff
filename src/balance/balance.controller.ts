import {
  Controller, Get, Post, Param, Query, Body, UseGuards,
  ParseBoolPipe, DefaultValuePipe, HttpCode,
} from '@nestjs/common';
import { BalanceService } from './balance.service';
import { BatchSyncDto } from './balance.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('balances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':employeeId')
  getByEmployee(@Param('employeeId') employeeId: string) {
    return this.balanceService.getByEmployee(employeeId);
  }

  @Get(':employeeId/:locationId')
  getOne(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query('leaveType') leaveType?: string,
    @Query('refresh', new DefaultValuePipe(false), ParseBoolPipe) refresh?: boolean,
  ) {
    return this.balanceService.getOne(employeeId, locationId, leaveType, refresh);
  }

  @Post('sync/batch')
  @HttpCode(200)
  @Roles('admin', 'system')
  processBatch(@Body() dto: BatchSyncDto) {
    return this.balanceService.processBatch(dto);
  }

  @Post('sync/refresh/:employeeId/:locationId/:leaveType')
  @HttpCode(200)
  @Roles('admin', 'manager', 'system')
  refreshBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Param('leaveType') leaveType: string,
  ) {
    return this.balanceService.refreshFromHcm(employeeId, locationId, leaveType);
  }
}