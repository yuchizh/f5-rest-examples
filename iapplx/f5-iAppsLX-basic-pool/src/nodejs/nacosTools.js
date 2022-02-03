const NacosNamingClient = require('nacos').NacosNamingClient;
const logger = console;
const axios = require('axios')

const NACOS_HOST = '127.0.0.1:8848' // replace to real nacos serverList

const PAGE_SIZE = 10

const client = new NacosNamingClient({
  logger,
  serverList: NACOS_HOST,
  namespace: 'public',
  
});

const nacosServer = axios.create({
  baseURL: `http://${NACOS_HOST}/nacos/v1/ns/service/list`,
  timeout: 1000,
})

/**
 * get all service name
 * @returns string[]
 */
async function getAllServiceName() {
  const serviceNames = []
  let pageNo = 1

  while (true) {
    const { doms } =  await nacosServer.get(`/?pageNo=${pageNo}&pageSize=${PAGE_SIZE}`)
    .then(data => data.data)
    .catch(() => [])

    serviceNames.push(...doms)

    if (!doms.length < pageSize) break
    pageNo += 1
  }

  return serviceNames
}

/**
 * get serviceInfo by service name
 * @param {*} serviceName string
 * @returns {Array} { ip: string, port: number }[]
 */
async function getServiceInfo(serviceName) {
  if (!serviceName) return {}

  await client.ready();
  const serviceInfo = await client.getAllInstances(serviceName)
  return serviceInfo
}

module.exports = {
  getServiceInfo,
  getAllServiceName
}