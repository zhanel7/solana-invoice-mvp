use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("Gu7xt63mKXHKhs5vrnkGo44E5fkGCDw2upWwjbtBeJSo");

#[program]
pub mod solana_invoice_mvp {
    use super::*;

    // 1. Создание счёта (инвойса) продавцом
    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        amount_lamports: u64,
        order_id: String,
    ) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;
        invoice.merchant = ctx.accounts.merchant.key();
        invoice.amount = amount_lamports;
        invoice.order_id = order_id;
        invoice.is_paid = false;

        msg!("Invoice created for order: {}", invoice.order_id);
        Ok(())
    }

    // 2. Оплата счёта покупателем
    pub fn pay_invoice(ctx: Context<PayInvoice>) -> Result<()> {
        let invoice = &mut ctx.accounts.invoice;
        require!(!invoice.is_paid, ErrorCode::AlreadyPaid);

        // Перевод SOL от покупателя продавцу
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.merchant.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, invoice.amount)?;

        invoice.is_paid = true;
        msg!("Invoice {} paid!", invoice.order_id);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount_lamports: u64, order_id: String)]
pub struct CreateInvoice<'info> {
    #[account(
        init,
        payer = merchant,
        space = 8 + 32 + 8 + (4 + 32) + 1,
        seeds = [b"invoice", merchant.key().as_ref(), order_id.as_bytes()],
        bump
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(mut)]
    pub merchant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayInvoice<'info> {
    #[account(
        mut,
        has_one = merchant,
        seeds = [b"invoice", merchant.key().as_ref(), invoice.order_id.as_bytes()],
        bump
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Адрес продавца проверяется через has_one = merchant
    #[account(mut)]
    pub merchant: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Invoice {
    pub merchant: Pubkey,
    pub amount: u64,
    pub order_id: String,
    pub is_paid: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Этот счёт уже оплачен!")]
    AlreadyPaid,
}
