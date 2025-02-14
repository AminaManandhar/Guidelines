/* eslint-disable no-console */
const config = require('config');
const axios = require('axios');
const ethers = require('ethers');
const { MailService } = require('@rumsan/core/services');
const { createMessage } = require('./plugins/template');
const sms = require('./plugins/sms');
const pinService = require('./plugins/pin');
const { syncFromGsheet, updateServerStartDate, getSqlitePinsCount, getLastStartDate } = require('./utils/tools');
const sendOtp = require('./utils/sendOtp')

const mailConfig = require('../config/mail.json');

console.log(mailConfig)
const { id } = require('ethers/lib/utils');

MailService.setConfig(mailConfig);

const rahatServer = config.get('rahat_server');
const websocketProvider = config.get('blockchain.webSocketProvider');
const privateKey = config.get('private_key');
const { abi } = require('./abi.json')

const provider = new ethers.providers.WebSocketProvider(websocketProvider);
const wallet = new ethers.Wallet(privateKey, provider);
let currentContract = null;

const api = axios.create({
  baseURL: rahatServer,
  headers: {
    'otp-server': true
  }
});

module.exports = {
  /**
   * Get contract information from Rahat server
   */
  async getContract(contractName = 'RahatClaim') {
    // const res = await api.get(`/api/v1/app/contracts/${contractName}`);

    const address = "0x2B539E5cAe0b01728BF6fFcE1F17aEbb0Adbd39c";
    // const { abi, address } = res.data;
    // res = await axios(`${rahatServer}/api/v1/app/settings`);
    // const contractAddress = res.data.agency.contracts.rahat;
    return new ethers.Contract(address, abi, wallet);
  },

  /**
   * Create SHA3 hash of OTP.
   * @param {string} payload data to create hash
   */
  generateHash(payload) {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(payload));
  },

  /**
   * Call contract function to store OTP hash in blockchain.
   * @param {string} payload data to create hash
   */
  async setHashToChain_ERC20(contract, claimId, otp) {
    const timeToLive = 900000000000000;
    const otpHash = this.generateHash(otp);
    return contract.addOtpToClaim(claimId, otpHash, timeToLive);
  },

  async getOtp(phone, vendor) {
    phone = phone.toString();
    const otp = await pinService(phone, vendor);
    if (!otp) return null;
    return otp.toString();
  },

  async sendMessage(phone, otp, amount, claimId) {
    if (phone.toString().slice(0, 3) === '999') return null;
    const message =
      createMessage(otp, amount) || `Please provide this code to vendor: ${otp}. (Transaction amount: ${amount})`;
    try {
      sendOtp('rahat@mailinator.com', otp)
      console.log("successfully sent otp to mail and whatsapp")
    } catch (error) {
      console.log(error)
    }

    return null;
  },

  async addOtpToClaim(claimId, otp) {
    console.log('OTP: ==>', otp);
    console.log('============================');
    const rahatClaim = await this.getContract('RahatClaim');

    const otpHash = id(otp);
    const expiryDate = Math.floor(Date.now() / 1000) + 86400;
    await rahatClaim.addOtpToClaim(claimId, otpHash, expiryDate);
    const finalClaimsState = await rahatClaim.claims(claimId);
    return finalClaimsState;
  },

  /**
   * Listen to blockchain events
   */

  async contractListen() {
    currentContract = await this.getContract();
    currentContract.on(
      'ClaimCreated',
      async (claimId, claimerAddress, claimeeAddress, tokenAddress, otpServer, amount) => {
        try {
          console.log({
            msg: 'ClaimCreated',
            claimId,
            claimerAddress,
            claimeeAddress,
            tokenAddress,
            otpServer,
            amount
          });

          // const {
          //   data: { rows }
          // } = await api.get(`/api/v1/beneficiaries?walletAddress=${claimeeAddress.toLowerCase()}`);

          const beneficiaryPhone = '9868823984';

          const otp = await this.getOtp(beneficiaryPhone, otpServer);
          // const state = await this.addOtpToClaim(claimId, otp);
          // if (!otp) return;
          if (!otp) return;
          await this.setHashToChain_ERC20(currentContract, claimId, otp);
          this.sendMessage(beneficiaryPhone, otp, amount, claimId);

          // console.log({
          //   vendor,
          //   phone: phone?.toNumber(),
          //   amount: amount?.toNumber(),
          //   otp
          // });
        } catch (e) {
          console.log(e);
        }
      }
    );
    console.log('----------------------------------------');
    console.log(`Contract: ${currentContract.address}`);
    console.log(`Wallet: ${wallet.address}`);
    console.log('> Listening to events...');
    console.log('----------------------------------------');
  },

  async contractStopListen() {
    currentContract.off('ClaimedERC20');
    console.log('Contract stop for ClaimedERC20');
  },

  async listen() {
    // await updateServerStartDate();
    await this.contractListen();

    // provider.on('pending', async txHash => {
    //   const tx = await provider.getTransaction(txHash);
    //   if (tx.to === wallet.address) {
    //     const amount = ethers.utils.formatEther(tx.value);

    //     try {
    //       if (amount === '0.0067') {
    //         MailService.send({
    //           to: config.get('adminEmail'),
    //           subject: 'Rahat OTP Server Commands',
    //           html: `
    //           Send these amount to ${wallet.address} to run following commands.<br />
    //           0.0066 - Ping Test<br />
    //           0.0068 - Gsheet PIN Sync<br />
    //           0.0069 - Email Server Information<br />
    //           `
    //         });
    //       }

    //       if (amount === '0.0066') {
    //         sms('9868823984', 'ping');
    //       }

    //       if (amount === '0.0068') {
    //         syncFromGsheet();
    //       }

    //       if (amount === '0.0069') {
    //         await this.contractStopListen();
    //         await this.contractListen();

    //         const startInfo = await getLastStartDate();
    //         MailService.send({
    //           to: config.get('adminEmail'),
    //           subject: 'Rahat OTP Server Information',
    //           html: `Rahat contract address: ${currentContract.address}<br />
    //         Server Wallet address: ${wallet.address}<br />
    //         Blockchain network: ${config.get('blockchain.webSocketProvider')}<br />
    //         SMS Service enabled: ${config.get('enabled')}<br />
    //         SMS Service: ${config.get('sms_service')}<br />
    //         Pin Service: ${config.get('pin_service')}<br />
    //         Test OTP Pin: ${await this.getOtp('9868823984')}<br />
    //         Default OTP Code: ${config.get('otp.defaultCode')}<br />
    //         Total SQLLite Pin count: 4<br />
    //         Server Started on: ${startInfo.date} (${startInfo.duration})
    //         `
    //         }).then(e => {
    //           console.log('email sent.');
    //         });
    //       }
    //     } catch (e) {
    //       console.log(e.message);
    //     }

    //     console.log('Command code:', amount);
    //   }
    // });
  }
};
